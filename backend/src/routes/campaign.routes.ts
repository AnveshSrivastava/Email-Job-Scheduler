import { Router } from 'express';
import { createCampaign, getCampaign, getCampaignJobs, importCampaignCsv, upload } from '../controllers/campaign.controller';

const router = Router();

router.post('/', createCampaign);
router.post('/import', upload.single('file'), importCampaignCsv);
router.get('/:id', getCampaign);
router.get('/:id/jobs', getCampaignJobs);

export default router;
