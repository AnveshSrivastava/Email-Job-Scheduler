import express, { Express } from 'express';
import cookieParser from 'cookie-parser';
import cors from 'cors';
import healthRoutes from './routes/health.routes';
import campaignRoutes from './routes/campaign.routes';
import authRoutes from './routes/auth.routes';
import senderRoutes from './routes/sender.routes';
import { config } from './config/env';

export const createApp = (): Express => {
  const app = express();

  // Middleware
  app.use(
    cors({
      origin: config.FRONTEND_URL,
      credentials: true,
    }),
  );
  app.use(express.json());
  app.use(cookieParser());

  // Routes
  app.use('/health', healthRoutes);
  app.use('/api/v1/auth', authRoutes);
  app.use('/api/v1/campaigns', campaignRoutes);
  app.use('/api/v1/senders', senderRoutes);

  // Global Error Handler
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if ((err.name && err.name.includes('ApplicationError')) || 'statusCode' in err) {
      const appErr = err as any;
      res.status(appErr.statusCode || 400).json({
        error: {
          code: appErr.code || 'BAD_REQUEST',
          message: appErr.message,
          details: appErr.details,
        },
      });
      return;
    }

    console.error('Unhandled internal error:', err);
    res
      .status(500)
      .json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' } });
  });

  return app;
};
