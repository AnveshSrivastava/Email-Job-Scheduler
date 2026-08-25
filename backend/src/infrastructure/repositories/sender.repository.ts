import { PrismaClient, Sender, Prisma } from '@prisma/client';

export class SenderRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async create(data: Prisma.SenderUncheckedCreateInput): Promise<Sender> {
    return this.prisma.sender.create({ data });
  }

  async findById(id: string): Promise<Sender | null> {
    return this.prisma.sender.findUnique({ where: { id } });
  }

  async findByUserId(userId: string): Promise<Sender[]> {
    return this.prisma.sender.findMany({ where: { userId } });
  }
}
