import { NextRequest, NextResponse } from 'next/server'
import type { Prisma } from '@prisma/client'

import { prisma } from '@/lib/prisma'
import { requireRoles } from '@/lib/api-security'

const nonSuperAdminUserWhere: Prisma.UserWhereInput = {
  deletedAt: null,
  OR: [
    { role: null },
    {
      role: {
        notIn: ['SUPER_ADMIN', 'super_admin']
      }
    }
  ]
}

const safeCount = (result: PromiseSettledResult<number>): number => {
  if (result.status === 'fulfilled') {
    return Number(result.value || 0)
  }
  return 0
}

async function settledCount(query: Promise<number>): Promise<PromiseSettledResult<number>> {
  try {
    const value = await query
    return { status: 'fulfilled', value }
  } catch (reason) {
    return { status: 'rejected', reason }
  }
}

const STATS_CACHE_TTL_MS = 10_000
let statsCache:
  | {
      payload: Record<string, unknown>
      expiresAt: number
    }
  | null = null

export async function GET(request: NextRequest) {
  const authResult = requireRoles(request, ['super_admin'])
  if (!authResult.ok) return authResult.response

  const now = Date.now()
  if (statsCache && now < statsCache.expiresAt) {
    return NextResponse.json(statsCache.payload)
  }

  // Run count queries in a controlled sequence to avoid saturating small
  // Prisma pools during parallel super-admin dashboard loads.
  const results = [
    await settledCount(prisma.trader.count({ where: { deletedAt: null } })),
    await settledCount(prisma.trader.count({ where: { deletedAt: null, locked: true } })),
    await settledCount(prisma.company.count({ where: { deletedAt: null } })),
    await settledCount(prisma.company.count({ where: { deletedAt: null, locked: true } })),
    await settledCount(prisma.user.count({ where: nonSuperAdminUserWhere })),
    await settledCount(
      prisma.user.count({
        where: {
          ...nonSuperAdminUserWhere,
          locked: true
        }
      })
    ),
    await settledCount(prisma.purchaseBill.count()),
    await settledCount(prisma.salesBill.count())
  ]

  const stats = {
    totalTraders: safeCount(results[0]),
    lockedTraders: safeCount(results[1]),
    totalCompanies: safeCount(results[2]),
    lockedCompanies: safeCount(results[3]),
    totalUsers: safeCount(results[4]),
    lockedUsers: safeCount(results[5]),
    totalPurchaseBills: safeCount(results[6]),
    totalSalesBills: safeCount(results[7]),
    partial: results.some((result) => result.status === 'rejected'),
    lastUpdated: new Date().toISOString()
  }

  statsCache = {
    payload: stats,
    expiresAt: now + STATS_CACHE_TTL_MS
  }

  return NextResponse.json(stats)
}
