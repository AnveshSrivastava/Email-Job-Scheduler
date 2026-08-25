import { createApp } from './app';
import { config } from './config/env';

const startServer = () => {
  const app = createApp();

  app.listen(config.PORT, () => {
    console.log(`🚀 Server listening on port ${config.PORT} in ${config.NODE_ENV} mode`);
  });
};

startServer();
