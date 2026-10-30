const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const path = require('node:path');
const fs = require('node:fs');
const yaml = require('yaml');
const swaggerUi = require('swagger-ui-express');

const config = require('./config');
const logger = require('./utils/logger');
const { apiLimiter } = require('./middleware/rateLimiter');

const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const driverRoutes = require('./routes/driverRoutes');
const deliveryRoutes = require('./routes/deliveryRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');

const app = express();

// Set trust proxy for production deployments behind reverse proxies
app.set('trust proxy', 1);

// HTTP Security Headers
app.use(helmet({
  contentSecurityPolicy: false // Allows dashboard and swagger assets
}));

// CORS Configuration with Expose Headers
app.use(cors({
  origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
  exposedHeaders: ['X-Total-Count', 'X-Page', 'X-Limit', 'X-Total-Pages']
}));

// Request parsing
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Structured Request Logging (pino) - auto-disabled in test mode
if (!config.isTest) {
  app.use(pinoHttp({
    logger,
    autoLogging: {
      ignore: (req) => req.url === '/health' || req.url.startsWith('/public')
    }
  }));
}

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Swagger / OpenAPI documentation UI at /api/docs
try {
  const openApiPath = path.join(__dirname, 'docs', 'openapi.yaml');
  if (fs.existsSync(openApiPath)) {
    const yamlContent = fs.readFileSync(openApiPath, 'utf8');
    const swaggerDoc = yaml.parse(yamlContent);
    app.use('/api/docs', swaggerUi.serve, swaggerUi.setup(swaggerDoc));
  }
} catch (err) {
  logger.warn({ error: err.message }, 'Failed to initialize Swagger UI documentation');
}

// Mount Authentication routes
app.use('/auth', authRoutes);

// Apply API Rate Limiting to business endpoints
app.use('/vehicles', apiLimiter);
app.use('/drivers', apiLimiter);
app.use('/deliveries', apiLimiter);
app.use('/api', apiLimiter);

// Mount domain routes
app.use('/', healthRoutes);
app.use('/', vehicleRoutes);
app.use('/', driverRoutes);
app.use('/', deliveryRoutes);
app.use('/api', dashboardRoutes);

// 404 handler for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'NotFoundError',
    message: `Endpoint ${req.method} ${req.originalUrl} not found`
  });
});

// Centralized error handler with consistent structure
app.use((err, req, res, next) => {
  const status = err.statusCode || (err.status >= 400 && err.status < 600 ? err.status : 500);
  const response = {
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected error occurred'
  };

  if (err.details) {
    response.details = err.details;
  }

  if (process.env.NODE_ENV !== 'production' && err.stack) {
    response.stack = err.stack;
  }

  res.status(status).json(response);
});

module.exports = app;
