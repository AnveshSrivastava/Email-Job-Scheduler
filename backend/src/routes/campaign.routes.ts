import { Router } from 'express';
import {
  createCampaign,
  getCampaign,
  getCampaigns,
  getCampaignJobs,
  importCampaignCsv,
  retryCampaign,
  upload,
} from '../controllers/campaign.controller';
import { authMiddleware } from '../middleware/auth.middleware';

const router = Router();

router.use(authMiddleware);

router.get('/', getCampaigns);
router.post('/', createCampaign);
router.post('/import', upload.single('file'), importCampaignCsv);
router.get('/:id', getCampaign);
router.post('/:id/retry', retryCampaign);
router.get('/:id/jobs', getCampaignJobs);

export default router;
