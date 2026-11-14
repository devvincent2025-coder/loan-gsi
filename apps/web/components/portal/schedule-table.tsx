import type { ScheduleLine } from '@damez/shared';
import { formatLagos } from '@damez/shared';
import { MoneyText } from '@/components/money';

export function ScheduleTable({ schedule }: { schedule: ScheduleLine[] }) {
  return (
    <div className="max-h-80 overflow-auto rounded-md border">
      <table className="w-full text-xs">
        <caption className="sr-only">Repayment schedule</caption>
        <thead className="sticky top-0 bg-muted text-left text-muted-foreground">
          <tr>
            <th scope="col" className="px-2 py-2 font-medium">#</th>
            <th scope="col" className="px-2 py-2 font-medium">Due</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Principal</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Interest</th>
            <th scope="col" className="px-2 py-2 text-right font-medium">Total</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {schedule.map((l) => (
            <tr key={l.n}>
              <td className="px-2 py-1.5">{l.n}</td>
              <td className="px-2 py-1.5 whitespace-nowrap">{formatLagos(`${l.dueDate}T12:00:00Z`, 'date')}</td>
              <td className="px-2 py-1.5 text-right"><MoneyText kobo={l.principalKobo} trimZeroKobo /></td>
              <td className="px-2 py-1.5 text-right"><MoneyText kobo={l.interestKobo} trimZeroKobo /></td>
              <td className="px-2 py-1.5 text-right font-medium"><MoneyText kobo={l.totalKobo} trimZeroKobo /></td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
