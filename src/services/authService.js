const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const config = require('../config');
const userRepository = require('../repositories/userRepository');
const driverRepository = require('../repositories/driverRepository');
const {
  BadRequestError,
  UnauthorizedError,
  ConflictError,
  NotFoundError
} = require('../utils/errors');

class AuthService {
  hashToken(token) {
    return crypto.createHash('sha256').update(token).digest('hex');
  }

  generateAccessToken(user) {
    const payload = {
      sub: user.id,
      username: user.username,
      role: user.role,
      driver_id: user.driver_id || null
    };
    return jwt.sign(payload, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn
    });
  }

  generateRefreshToken(user) {
    const rawToken = crypto.randomBytes(40).toString('hex');
    const tokenHash = this.hashToken(rawToken);
    
    // Parse expiry (e.g. '7d' -> 7 days in ms)
    const expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();

    userRepository.storeRefreshToken({
      id: crypto.randomUUID(),
      user_id: user.id,
      token_hash: tokenHash,
      expires_at: expiresAt
    });

    return {
      refreshToken: rawToken,
      expiresAt
    };
  }

  register({ username, password, role = 'dispatcher', driver_id = null }) {
    if (!username || !password) {
      throw new BadRequestError('Username and password are required');
    }

    const trimmedUsername = username.trim().toLowerCase();
    const existing = userRepository.findByUsername(trimmedUsername);
    if (existing) {
      throw new ConflictError(`User with username '${trimmedUsername}' already exists`);
    }

    // Role validation
    const validRoles = ['admin', 'dispatcher', 'driver', 'fleet_manager'];
    const normalizedRole = role === 'fleet_manager' ? 'admin' : role;
    if (!validRoles.includes(role)) {
      throw new BadRequestError(`Invalid role. Must be one of: ${validRoles.join(', ')}`);
    }

    // If driver role, validate driver_id if provided
    if (normalizedRole === 'driver' && driver_id) {
      const driver = driverRepository.findById(driver_id);
      if (!driver) {
        throw new NotFoundError(`Referenced driver '${driver_id}' not found`);
      }
    }

    const passwordHash = bcrypt.hashSync(password, 10);
    const userId = crypto.randomUUID();

    const user = userRepository.create({
      id: userId,
      username: trimmedUsername,
      password_hash: passwordHash,
      role: normalizedRole,
      driver_id: normalizedRole === 'driver' ? driver_id : null
    });

    return {
      id: user.id,
      username: user.username,
      role: user.role,
      driver_id: user.driver_id,
      created_at: user.created_at
    };
  }

  login({ username, password }) {
    if (!username || !password) {
      throw new BadRequestError('Username and password are required');
    }

    const trimmedUsername = username.trim().toLowerCase();
    const user = userRepository.findByUsername(trimmedUsername);
    if (!user) {
      throw new UnauthorizedError('Invalid username or password');
    }

    const passwordValid = bcrypt.compareSync(password, user.password_hash);
    if (!passwordValid) {
      throw new UnauthorizedError('Invalid username or password');
    }

    const accessToken = this.generateAccessToken(user);
    const { refreshToken, expiresAt } = this.generateRefreshToken(user);

    return {
      accessToken,
      refreshToken,
      tokenType: 'Bearer',
      expiresIn: config.jwt.expiresIn,
      refreshExpiresAt: expiresAt,
      user: {
        id: user.id,
        username: user.username,
        role: user.role,
        driver_id: user.driver_id
      }
    };
  }

  refresh({ refreshToken }) {
    if (!refreshToken) {
      throw new BadRequestError('Refresh token is required');
    }

    const tokenHash = this.hashToken(refreshToken);
    const record = userRepository.findRefreshToken(tokenHash);

    if (!record) {
      throw new UnauthorizedError('Invalid refresh token');
    }

    if (record.revoked_at) {
      // Possible token reuse attempt: revoke all user sessions for safety
      userRepository.revokeAllUserRefreshTokens(record.user_id);
      throw new UnauthorizedError('Revoked refresh token presented. All active sessions have been terminated for security.');
    }

    if (new Date(record.expires_at) < new Date()) {
      throw new UnauthorizedError('Refresh token has expired. Please log in again.');
    }

    // ROTATE: Revoke the old refresh token
    userRepository.revokeRefreshToken(tokenHash);

    const user = {
      id: record.user_id,
      username: record.username,
      role: record.role,
      driver_id: record.driver_id
    };

    const newAccessToken = this.generateAccessToken(user);
    const { refreshToken: newRefreshToken, expiresAt } = this.generateRefreshToken(user);

    return {
      accessToken: newAccessToken,
      refreshToken: newRefreshToken,
      tokenType: 'Bearer',
      expiresIn: config.jwt.expiresIn,
      refreshExpiresAt: expiresAt,
      user
    };
  }

  logout({ refreshToken }) {
    if (refreshToken) {
      const tokenHash = this.hashToken(refreshToken);
      userRepository.revokeRefreshToken(tokenHash);
    }
    return { success: true, message: 'Logged out successfully' };
  }
}

module.exports = new AuthService();

