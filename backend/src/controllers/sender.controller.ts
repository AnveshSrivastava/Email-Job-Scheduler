import { Request, Response, NextFunction } from 'express';
import { z } from 'zod';
import { prisma } from '../infrastructure/database/prisma';
import { SenderRepository } from '../infrastructure/repositories/sender.repository';
import { ValidationError, ApplicationError } from '../errors/application-error';

const senderRepo = new SenderRepository(prisma);

const createSenderSchema = z.object({
  email: z.string().email('Invalid email address'),
  displayName: z.string().optional(),
  smtpUsername: z.string().optional(),
  smtpPassword: z.string().optional(),
});

export const getSenders = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;
    const senders = await senderRepo.findByUserId(userId);

    res.json({ data: senders });
  } catch (error) {
    next(error);
  }
};

export const createSender = async (req: Request, res: Response, next: NextFunction) => {
  try {
    const userId = req.user!.id;

    const parsed = createSenderSchema.safeParse(req.body);
    if (!parsed.success) {
      throw new ValidationError('Invalid request payload', parsed.error.format());
    }

    // Check for duplicate sender email for this user
    const existing = await prisma.sender.findFirst({
      where: {
        userId,
        email: parsed.data.email,
      },
    });

    if (existing) {
      throw new ValidationError('Sender with this email already exists for this user');
    }

    const sender = await senderRepo.create({
      userId,
      ...parsed.data,
    });

    res.status(201).json({ data: sender });
  } catch (error) {
    next(error);
  }
};
