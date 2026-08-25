import express, { Express } from 'express';
import healthRoutes from './routes/health.routes';
import campaignRoutes from './routes/campaign.routes';

export const createApp = (): Express => {
  const app = express();

  // Middleware
  app.use(express.json());

  // Routes
  app.use('/health', healthRoutes);
  app.use('/api/v1/campaigns', campaignRoutes);

  // Global Error Handler
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    if (err.name && err.name.includes('ApplicationError') || 'statusCode' in err) {
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
    res.status(500).json({ error: { code: 'INTERNAL_SERVER_ERROR', message: 'Internal Server Error' } });
  });

  return app;
};
