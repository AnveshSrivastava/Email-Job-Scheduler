import { PrismaClient, EmailJob, EmailJobStatus, Prisma } from '@prisma/client';

export class EmailJobRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async createMany(data: Prisma.EmailJobUncheckedCreateInput[]): Promise<Prisma.BatchPayload> {
    return this.prisma.emailJob.createMany({ data });
  }

  async findById(id: string): Promise<EmailJob | null> {
    return this.prisma.emailJob.findUnique({ where: { id } });
  }

  async findByBatchId(
    batchId: string,
    limit: number = 50,
    offset: number = 0,
  ): Promise<EmailJob[]> {
    return this.prisma.emailJob.findMany({
      where: { batchId },
      orderBy: { sequenceNumber: 'asc' },
      take: limit,
      skip: offset,
    });
  }

  async findScheduled(limit: number = 100): Promise<EmailJob[]> {
    return this.prisma.emailJob.findMany({
      where: { status: EmailJobStatus.SCHEDULED },
      orderBy: { scheduledAt: 'asc' },
      take: limit,
    });
  }

  async updateStatus(
    id: string,
    status: EmailJobStatus,
    extra: Partial<Pick<EmailJob, 'sentAt' | 'failedAt' | 'errorMessage'>> = {},
  ): Promise<EmailJob> {
    return this.prisma.emailJob.update({
      where: { id },
      data: {
        status,
        ...extra,
      },
    });
  }
}
