const express = require('express');
const cors = require('cors');
const path = require('node:path');
const healthRoutes = require('./routes/healthRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const driverRoutes = require('./routes/driverRoutes');

const app = express();

// Middlewares
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Serve static frontend assets
app.use(express.static(path.join(__dirname, 'public')));

// Mount routes
app.use('/', healthRoutes);
app.use('/', vehicleRoutes);
app.use('/', driverRoutes);

// 404 handler for unknown API routes
app.use('/api', (req, res) => {
  res.status(404).json({
    error: 'NotFoundError',
    message: `Endpoint ${req.method} ${req.originalUrl} not found`
  });
});

// Centralized error handler
app.use((err, req, res, next) => {
  const status = err.statusCode || (err.status >= 400 && err.status < 600 ? err.status : 500);
  const response = {
    error: err.name || 'InternalServerError',
    message: err.message || 'An unexpected error occurred'
  };

  if (process.env.NODE_ENV !== 'production' && err.stack) {
    response.stack = err.stack;
  }

  res.status(status).json(response);
});

module.exports = app;
