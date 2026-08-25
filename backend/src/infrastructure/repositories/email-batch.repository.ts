import { PrismaClient, EmailBatch, EmailJob, Prisma } from '@prisma/client';

export class EmailBatchRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createWithJobs(
    batchData: Prisma.EmailBatchUncheckedCreateInput,
    jobsData: Omit<Prisma.EmailJobUncheckedCreateInput, 'batchId'>[],
  ): Promise<EmailBatch> {
    return this.prisma.$transaction(async (tx) => {
      const batch = await tx.emailBatch.create({ data: batchData });

      const mappedJobs = jobsData.map((job) => ({
        ...job,
        batchId: batch.id,
      }));

      await tx.emailJob.createMany({
        data: mappedJobs,
      });

      return batch;
    });
  }

  async findById(id: string): Promise<EmailBatch | null> {
    return this.prisma.emailBatch.findUnique({ where: { id } });
  }

  async findByUserId(userId: string): Promise<EmailBatch[]> {
    return this.prisma.emailBatch.findMany({ where: { userId } });
  }
}
