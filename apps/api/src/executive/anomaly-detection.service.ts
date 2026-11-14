import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_ENV, AppEnv } from '../config/config.module';
import { PrismaService } from '../prisma/prisma.service';

type AnomalySeverity = 'INFO' | 'WARNING' | 'CRITICAL';

interface AnomalyInput {
  metric: string;
  dimension?: string;
  severity: AnomalySeverity;
  zScore: number;
  baseline: number;
  actual: number;
  description: string;
}

@Injectable()
export class AnomalyDetectionService {
  private readonly log = new Logger('AnomalyDetection');

  constructor(
    private readonly prisma: PrismaService,
    @Inject(APP_ENV) private readonly env: AppEnv,
  ) {}

  /** Compute z-score for a single value given a population. */
  computeZScore(values: number[], latest: number): number {
    if (values.length < 2) return 0;
    const mean = values.reduce((a, b) => a + b, 0) / values.length;
    const variance = values.reduce((s, v) => s + (v - mean) ** 2, 0) / (values.length - 1);
    const std = Math.sqrt(variance);
    if (std === 0) return 0;
    return (latest - mean) / std;
  }

  private severityFromZScore(z: number): AnomalySeverity {
    const abs = Math.abs(z);
    if (abs >= 4) return 'CRITICAL';
    if (abs >= 3) return 'WARNING';
    return 'INFO';
  }

  private async createAnomaly(input: AnomalyInput): Promise<string> {
    const record = await this.prisma.anomalyRecord.create({
      data: {
        metric: input.metric,
        dimension: input.dimension ?? null,
        severity: input.severity as never,
        zScore: input.zScore,
        baseline: input.baseline,
        actual: input.actual,
        description: input.description,
      },
    });
    return record.id;
  }

  /** Detect portfolio-level anomalies using rolling 30-day baselines. */
  async detectPortfolioAnomalies(): Promise<string[]> {
    const threshold = this.env.ANOMALY_ZCORE_THRESHOLD;
    const minPeriods = this.env.ANOMALY_MIN_PERIODS;

    const rows = await this.prisma.portfolioDailyMetrics.findMany({
      orderBy: { snapshotDate: 'desc' },
      take: 31,
    });

    if (rows.length < minPeriods + 1) return [];

    const latest = rows[0];
    const history = rows.slice(1); // previous 30 days (baseline)

    const ids: string[] = [];

    const metrics: Array<{ key: keyof typeof latest; label: string; higherIsBad: boolean }> = [
      { key: 'par30Ratio', label: 'PAR-30 Ratio', higherIsBad: true },
      { key: 'par90Ratio', label: 'PAR-90 Ratio', higherIsBad: true },
      { key: 'nplRatio', label: 'NPL Ratio', higherIsBad: true },
      { key: 'collectionEfficiency', label: 'Collection Efficiency', higherIsBad: false },
    ];

    for (const m of metrics) {
      const histValues = history.map((r) => r[m.key] as number);
      const latestVal = latest[m.key] as number;
      const z = this.computeZScore(histValues, latestVal);
      const baseline = histValues.reduce((a, b) => a + b, 0) / histValues.length;

      // Flag only if z-score exceeds threshold in the "bad" direction
      const isBadDirection = m.higherIsBad ? z > threshold : z < -threshold;
      if (Math.abs(z) >= threshold && isBadDirection) {
        const severity = this.severityFromZScore(z);
        const id = await this.createAnomaly({
          metric: m.key,
          severity,
          zScore: z,
          baseline,
          actual: latestVal,
          description: `Portfolio ${m.label} is ${m.higherIsBad ? 'elevated' : 'depressed'}: ${(latestVal * 100).toFixed(2)}% vs baseline ${(baseline * 100).toFixed(2)}% (z=${z.toFixed(2)})`,
        });
        ids.push(id);
        this.log.warn(`Portfolio anomaly: ${m.key} z=${z.toFixed(2)}`);
      }
    }

    return ids;
  }

  /** Detect per-branch anomalies. */
  async detectBranchAnomalies(): Promise<string[]> {
    const threshold = this.env.ANOMALY_ZCORE_THRESHOLD;
    const minPeriods = this.env.ANOMALY_MIN_PERIODS;

    const branches = await this.prisma.branch.findMany({ select: { id: true, name: true } });
    const ids: string[] = [];

    for (const branch of branches) {
      const rows = await this.prisma.branchDailyMetrics.findMany({
        where: { branchId: branch.id },
        orderBy: { snapshotDate: 'desc' },
        take: 31,
      });

      if (rows.length < minPeriods + 1) continue;

      const latest = rows[0];
      const history = rows.slice(1);

      const metrics: Array<{ key: 'par30Ratio' | 'par90Ratio' | 'nplRatio'; label: string }> = [
        { key: 'par30Ratio', label: 'PAR-30' },
        { key: 'par90Ratio', label: 'PAR-90' },
        { key: 'nplRatio', label: 'NPL' },
      ];

      for (const m of metrics) {
        const histValues = history.map((r) => r[m.key]);
        const latestVal = latest[m.key];
        const z = this.computeZScore(histValues, latestVal);
        const baseline = histValues.reduce((a, b) => a + b, 0) / histValues.length;

        if (z >= threshold) {
          const severity = this.severityFromZScore(z);
          const id = await this.createAnomaly({
            metric: m.key,
            dimension: branch.id,
            severity,
            zScore: z,
            baseline,
            actual: latestVal,
            description: `Branch "${branch.name}" ${m.label} spike: ${(latestVal * 100).toFixed(2)}% vs baseline ${(baseline * 100).toFixed(2)}% (z=${z.toFixed(2)})`,
          });
          ids.push(id);
        }
      }
    }

    return ids;
  }

  /** Detect sudden failure-rate spikes in debit attempts by bank. */
  async detectDebitAnomalies(): Promise<string[]> {
    const threshold = this.env.ANOMALY_ZCORE_THRESHOLD;

    const rows = await this.prisma.debitDaily.findMany({
      orderBy: { snapshotDate: 'desc' },
      take: 33 * 10, // up to 10 banks * 33 days
    });

    const bankMap = new Map<string, typeof rows>();
    for (const row of rows) {
      const key = row.bankCode ?? '__all__';
      if (!bankMap.has(key)) bankMap.set(key, []);
      bankMap.get(key)!.push(row);
    }

    const ids: string[] = [];

    for (const [bankCode, bankRows] of bankMap.entries()) {
      const sorted = bankRows.sort((a, b) => b.snapshotDate.getTime() - a.snapshotDate.getTime());
      if (sorted.length < 5) continue;

      const latest3 = sorted.slice(0, 3);
      const history = sorted.slice(3);

      const recentFailRate = latest3.reduce((s, r) => {
        const total = r.totalAttempts || 1;
        return s + r.failureCount / total;
      }, 0) / 3;

      const histFailRates = history.map((r) => r.failureCount / (r.totalAttempts || 1));
      const z = this.computeZScore(histFailRates, recentFailRate);
      const baseline = histFailRates.reduce((a, b) => a + b, 0) / (histFailRates.length || 1);

      if (z >= threshold) {
        const severity = this.severityFromZScore(z);
        const id = await this.createAnomaly({
          metric: 'debitFailureRate',
          dimension: bankCode,
          severity,
          zScore: z,
          baseline,
          actual: recentFailRate,
          description: `Bank "${bankCode}" debit failure rate spike: ${(recentFailRate * 100).toFixed(1)}% (3-day avg) vs ${(baseline * 100).toFixed(1)}% baseline (z=${z.toFixed(2)})`,
        });
        ids.push(id);
      }
    }

    return ids;
  }

  /** Detect unusual queue growth in approval requests. */
  async detectApprovalAnomalies(): Promise<string[]> {
    const threshold = this.env.ANOMALY_ZCORE_THRESHOLD;

    const rows = await this.prisma.approvalsQueueSnapshot.findMany({
      orderBy: { snapshotDate: 'desc' },
      take: 31,
    });

    const typeMap = new Map<string, typeof rows>();
    for (const row of rows) {
      if (!typeMap.has(row.actionType)) typeMap.set(row.actionType, []);
      typeMap.get(row.actionType)!.push(row);
    }

    const ids: string[] = [];

    for (const [actionType, typeRows] of typeMap.entries()) {
      const sorted = typeRows.sort((a, b) => b.snapshotDate.getTime() - a.snapshotDate.getTime());
      if (sorted.length < 4) continue;

      const latest = sorted[0];
      const history = sorted.slice(1);

      const histPending = history.map((r) => r.pendingCount);
      const z = this.computeZScore(histPending, latest.pendingCount);
      const baseline = histPending.reduce((a, b) => a + b, 0) / histPending.length;

      if (z >= threshold) {
        const severity = this.severityFromZScore(z);
        const id = await this.createAnomaly({
          metric: 'approvalQueueSize',
          dimension: actionType,
          severity,
          zScore: z,
          baseline,
          actual: latest.pendingCount,
          description: `Approval queue for "${actionType}" has ${latest.pendingCount} pending (baseline: ${baseline.toFixed(0)}, z=${z.toFixed(2)})`,
        });
        ids.push(id);
      }
    }

    return ids;
  }

  /** Run all anomaly detections. Returns list of created AnomalyRecord IDs. */
  async runAll(): Promise<string[]> {
    const all: string[] = [];
    const steps = [
      { name: 'portfolio', fn: () => this.detectPortfolioAnomalies() },
      { name: 'branch', fn: () => this.detectBranchAnomalies() },
      { name: 'debit', fn: () => this.detectDebitAnomalies() },
      { name: 'approval', fn: () => this.detectApprovalAnomalies() },
    ];

    for (const step of steps) {
      try {
        const ids = await step.fn();
        all.push(...ids);
      } catch (err) {
        this.log.error(`Anomaly detection step '${step.name}' failed: ${(err as Error).message}`);
      }
    }

    this.log.log(`Anomaly detection complete: ${all.length} new anomalies`);
    return all;
  }
}
