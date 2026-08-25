import { Router } from 'express';
import { getSenders, createSender } from '../controllers/sender.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

router.get('/', getSenders);
router.post('/', createSender);

export default router;
