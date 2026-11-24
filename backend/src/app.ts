import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import { env } from './config/env.js';
import { requireBullBoardAuth } from './middleware/auth.js';
import { errorHandler } from './middleware/errorHandler.js';
import authRoutes from './routes/authRoutes.js';
import emailRoutes from './routes/emailRoutes.js';
import healthRoutes from './routes/healthRoutes.js';
import senderRoutes from './routes/senderRoutes.js';
import slackRoutes from './routes/slackRoutes.js';
import { bullBoardServerAdapter } from './services/queueService.js';

export function createApp(): express.Express {
  const app = express();

  app.set('trust proxy', 1);

  app.use(
    cors({
      origin: env.FRONTEND_URL,
      credentials: true,
    })
  );

  // Apply Helmet security headers while allowing Bull Board's inline dashboard scripts/styles on /admin/queues
  app.use((req, res, next) => {
    if (req.path.startsWith('/admin/queues')) {
      helmet({
        contentSecurityPolicy: false,
      })(req, res, next);
      return;
    }
    helmet()(req, res, next);
  });

  app.use(cookieParser());
  app.use(express.json({ limit: '5mb' }));
  app.use(express.urlencoded({ extended: true }));

  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/senders', senderRoutes);
  app.use('/api/emails', emailRoutes);
  app.use('/api/integrations/slack', slackRoutes);

  // Protected live BullMQ queue visibility dashboard
  app.use('/admin/queues', requireBullBoardAuth, bullBoardServerAdapter.getRouter());

  app.use((_req, res) => {
    res.status(404).json({
      error: {
        code: 'NOT_FOUND',
        message: 'Requested endpoint does not exist',
      },
    });
  });

  app.use(errorHandler);
  return app;
}
