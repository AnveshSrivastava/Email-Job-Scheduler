import express, { Express } from 'express';
import healthRoutes from './routes/health.routes';

export const createApp = (): Express => {
  const app = express();

  // Middleware
  app.use(express.json());

  // Routes
  app.use('/health', healthRoutes);

  // Global Error Handler
  app.use((err: Error, req: express.Request, res: express.Response, next: express.NextFunction) => {
    console.error('Unhandled error:', err.message);
    res.status(500).json({ error: 'Internal Server Error' });
  });

  return app;
};
