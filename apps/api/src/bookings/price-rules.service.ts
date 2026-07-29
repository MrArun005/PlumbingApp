/**
 * Loads the effective-dated PriceRule rows and hands the pure pricing engine a
 * plain rule set. Also records WHICH rule versions were used, so an invoice can
 * be reproduced exactly from the rules that applied at booking time.
 */
import { Inject, Injectable } from '@nestjs/common';
import type { PrismaClient } from '@pipefix/db';
import type { PriceRuleSet } from '@pipefix/pricing';
import { InternalError } from '@pipefix/shared';
import { PRISMA } from '../env';

export interface ResolvedRules {
  rules: PriceRuleSet;
  /** PriceRule ids frozen onto the booking for later reproduction. */
  versionIds: string[];
}

@Injectable()
export class PriceRulesService {
  constructor(@Inject(PRISMA) private readonly prisma: PrismaClient) {}

  async resolve(city: string, now: Date): Promise<ResolvedRules> {
    const rows = await this.prisma.priceRule.findMany({
      where: {
        effectiveFrom: { lte: now },
        OR: [{ effectiveTo: null }, { effectiveTo: { gte: now } }],
        // A city-specific rule wins over the global one; we sort below.
        AND: [{ OR: [{ city: null }, { city }] }],
      },
      orderBy: [{ version: 'desc' }],
    });

    // Prefer a city-specific rule of the highest version, else the global one.
    const pick = (type: string) => {
      const candidates = rows.filter((r) => r.type === type);
      return candidates.find((r) => r.city === city) ?? candidates.find((r) => r.city === null);
    };

    const night = pick('NIGHT');
    const holiday = pick('HOLIDAY');
    const emergency = pick('EMERGENCY_FEE');
    const surge = pick('SURGE');
    if (
      night === undefined ||
      holiday === undefined ||
      emergency === undefined ||
      surge === undefined
    ) {
      throw new InternalError('Pricing rules are not configured for this city.', { city });
    }

    const nightParams = night.params as {
      multiplierX100: number;
      startHourIst: number;
      endHourIst: number;
    };
    const holidayParams = holiday.params as {
      multiplierX100: number;
      sundays: boolean;
      holidayDatesIst: string[];
    };
    const emergencyParams = emergency.params as {
      E0Paise: string;
      E1Paise: string;
      e1WaiverSubtotalOverPaise: string;
    };
    const surgeParams = surge.params as { capX100: number };

    return {
      rules: {
        night: nightParams,
        holiday: holidayParams,
        emergencyFee: {
          e0Paise: BigInt(emergencyParams.E0Paise),
          e1Paise: BigInt(emergencyParams.E1Paise),
          e1WaiverSubtotalOverPaise: BigInt(emergencyParams.e1WaiverSubtotalOverPaise),
          // TODO(ca-review): confirm the GST treatment of convenience fees.
          gstRatePct: DEFAULT_GST_RATE_PCT,
        },
        surge: surgeParams,
      },
      versionIds: [night.id, holiday.id, emergency.id, surge.id],
    };
  }
}

/**
 * Placeholder GST rate until a CA maps each SAC code.
 * TODO(ca-review): plumbing services sit in the 9954xx family — replace this
 * single rate with per-SKU rates from Service.sacCode before the first real
 * invoice is issued. Every line already carries its own rate, so this is a
 * data change, not a code change.
 */
export const DEFAULT_GST_RATE_PCT = 18;
