export type LoanInstallment = {
  weekNo: number;
  openingPrincipal: number;
  principalDue: number;
  serviceChargeDue: number;
  totalDue: number;
};

const SERVICE_CHARGE_RATE = 0.24;
const EXTRA_DURATION_FACTOR = 0.22012731445465;
const WEEKS = 46;
const THOUSAND = 1000;

/**
 * Reproduces the uploaded Book1.xlsx "127 tk" sheet formulas.
 * The spreadsheet's 1,000 BDT example totals 1,000 principal + 127 service charge.
 * Amounts are scaled by each 1,000 BDT unit; no alternative interest method is assumed.
 */
export function calculateLoanSchedule(principal: number): LoanInstallment[] {
  if (!Number.isInteger(principal) || principal < 1000 || principal > 200000 || principal % 1000 !== 0) {
    throw new Error('ঋণের পরিমাণ ১,০০০ থেকে ২,০০,০০০ টাকার মধ্যে এবং ১,০০০ টাকার গুণিতক হতে হবে।');
  }

  const units = principal / THOUSAND;
  let opening = principal;
  const rows: LoanInstallment[] = [];

  for (let weekNo = 1; weekNo <= WEEKS; weekNo += 1) {
    let principalDue: number;
    let serviceChargeDue: number;

    if (weekNo < WEEKS) {
      serviceChargeDue = (opening * SERVICE_CHARGE_RATE) / WEEKS;
      if (weekNo === 1) serviceChargeDue += units;
      if (weekNo === 45) serviceChargeDue += EXTRA_DURATION_FACTOR * units;
      principalDue = (25 * units) - serviceChargeDue;
    } else {
      principalDue = units;
      serviceChargeDue = units;
    }

    rows.push({
      weekNo,
      openingPrincipal: opening,
      principalDue,
      serviceChargeDue,
      totalDue: principalDue + serviceChargeDue,
    });
    opening -= principalDue;
  }

  return rows;
}

/** Returns 46 meeting dates, excluding all explicitly registered closure dates. */
export function buildInstallmentDates(
  firstDate: string,
  meetingDay: number,
  closedDates: string[],
): string[] {
  if (!/^\\d{4}-\\d{2}-\\d{2}$/.test(firstDate) || meetingDay < 0 || meetingDay > 6) {
    throw new Error('প্রথম কিস্তির তারিখ অথবা সমিতির সভার দিন সঠিক নয়।');
  }
  const closed = new Set(closedDates);
  const date = new Date(`${firstDate}T12:00:00`);
  if (date.getDay() !== meetingDay) {
    throw new Error('প্রথম কিস্তির তারিখ সমিতির নির্ধারিত সভার দিনের সঙ্গে মিলতে হবে।');
  }

  const dates: string[] = [];
  while (dates.length < WEEKS) {
    const value = [
      date.getFullYear(),
      String(date.getMonth() + 1).padStart(2, '0'),
      String(date.getDate()).padStart(2, '0'),
    ].join('-');
    if (!closed.has(value)) dates.push(value);
    date.setDate(date.getDate() + 7);
  }
  return dates;
}
