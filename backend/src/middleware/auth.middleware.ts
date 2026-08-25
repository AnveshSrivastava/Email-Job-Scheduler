import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import { UnauthorizedError } from '../errors/application-error';
import { config } from '../config/env';

export interface JwtPayload {
  userId: string;
}

declare global {
  namespace Express {
    interface Request {
      user?: {
        id: string;
      };
    }
  }
}

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
  const token = req.cookies?.token;

  if (!token) {
    return next(new UnauthorizedError('Authentication required'));
  }

  try {
    const decoded = jwt.verify(token, config.JWT_SECRET) as JwtPayload;
    req.user = { id: decoded.userId };
    next();
  } catch (err) {
    return next(new UnauthorizedError('Invalid or expired token'));
  }
};
