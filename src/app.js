const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const pinoHttp = require('pino-http');
const path = require('node:path');
const fs = require('node:fs');
const yaml = require('yaml');
const swaggerUi = require('swagger-ui-express');

const defaultLogger = require('./utils/logger');
const requestIdMiddleware = require('./middleware/requestId');
const { apiLimiter } = require('./middleware/rateLimiter');

const healthRoutes = require('./routes/healthRoutes');
const authRoutes = require('./routes/authRoutes');
const vehicleRoutes = require('./routes/vehicleRoutes');
const driverRoutes = require('./routes/driverRoutes');
const deliveryRoutes = require('./routes/deliveryRoutes');
const dashboardRoutes = require('./routes/dashboardRoutes');
const proofRoutes = require('./routes/proofRoutes');
const trackingRoutes = require('./routes/trackingRoutes');
const notificationRoutes = require('./routes/notificationRoutes');
const maintenanceRoutes = require('./routes/maintenanceRoutes');
const reportRoutes = require('./routes/reportRoutes');
const outboxWorker = require('./services/notifications/outboxWorker');

/**
 * Express application factory.
 * Allows instantiation with custom configuration (e.g. testing different NODE_ENV or CORS settings).
 */
function createApp(customConfig = {}) {
  const config = {
    ...require('./config'),
    ...customConfig
  };

  const app = express();
  app.locals.config = config;

  // Set trust proxy for production deployments behind reverse proxies
  app.set('trust proxy', 1);

  // Request ID extraction and propagation
  app.use(requestIdMiddleware);

  // Structured HTTP request logging with Pino
  app.use(pinoHttp({
    logger: defaultLogger,
    genReqId: (req) => req.id,
    autoLogging: {
      ignore: (req) => req.url.startsWith('/health') || req.url.startsWith('/ready') || req.url.startsWith('/favicon.ico')
    }
  }));

  // Enhanced security headers via Helmet
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://unpkg.com"
        ],
        styleSrc: [
          "'self'",
          "'unsafe-inline'",
          "https://unpkg.com",
          "https://fonts.googleapis.com"
        ],
        fontSrc: [
          "'self'",
          "https://fonts.gstatic.com"
        ],
        imgSrc: [
          "'self'",
          "data:",
          "blob:",
          "https://*.tile.openstreetmap.org",
          "https://unpkg.com"
        ],
        connectSrc: [
          "'self'",
          "ws:",
          "wss:",
          "http:",
          "https:"
        ]
      }
    },
    crossOriginResourcePolicy: { policy: 'cross-origin' }
  }));

  // CORS configuration
  app.use(cors({
    origin: config.corsOrigin === '*' ? true : config.corsOrigin.split(','),
    credentials: true,
    exposedHeaders: ['X-Total-Count', 'X-Total-Pages', 'X-Current-Page', 'X-Per-Page', 'Content-Disposition', 'X-Request-ID']
  }));

  // Body parsers
  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true, limit: '1mb' }));

  // Serve static frontend assets
  app.use('/driver', express.static(path.join(__dirname, 'public', 'driver')));
  app.use('/track', express.static(path.join(__dirname, 'public', 'track')));
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
    defaultLogger.warn({ error: err.message }, 'Failed to initialize Swagger UI documentation');
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
  app.use('/', proofRoutes);
  app.use('/', trackingRoutes);
  app.use('/', notificationRoutes);
  app.use('/', maintenanceRoutes);
  app.use('/', reportRoutes);
  app.use('/api', dashboardRoutes);

  // Start background outbox notification worker
  outboxWorker.start();
  app.outboxWorker = outboxWorker;

  // 404 handler for unknown API routes
  app.use('/api', (req, res) => {
    res.status(404).json({
      error: 'NotFoundError',
      message: `Endpoint ${req.method} ${req.originalUrl} not found`
    });
  });

  // Centralized error handler with consistent structure
  app.use((err, req, res, _next) => {
    const status = err.statusCode || (err.status >= 400 && err.status < 600 ? err.status : 500);
    const response = {
      error: err.name || 'InternalServerError',
      message: err.message || 'An unexpected error occurred'
    };

    if (err.details) {
      response.details = err.details;
    }

    if (config.nodeEnv !== 'production' && err.stack) {
      response.stack = err.stack;
    }

    res.status(status).json(response);
  });

  return app;
}

// Default application instance for existing server.js and tests
const defaultApp = createApp();
defaultApp.createApp = createApp;

module.exports = defaultApp;
