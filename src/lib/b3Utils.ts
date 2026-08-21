export function getB3PeriodInfo(poaPeriod: string) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  let targetYear = currentYear;
  let targetMonth = currentMonth;

  if (poaPeriod) {
    if (poaPeriod.includes("-Q")) {
      const [yrStr, qStr] = poaPeriod.split("-Q");
      targetYear = parseInt(yrStr, 10) || currentYear;
      const q = parseInt(qStr, 10) || 1;
      targetMonth = (q - 1) * 3 + 1; // Q1 -> 1 (Jan), Q2 -> 4 (Apr), Q3 -> 7 (Jul), Q4 -> 10 (Oct)
    } else if (poaPeriod.length === 6) {
      targetYear = parseInt(poaPeriod.slice(0, 4), 10) || currentYear;
      targetMonth = parseInt(poaPeriod.slice(4, 6), 10) || currentMonth;
    }
  }

  const chosenPeriodNum = targetYear * 100 + targetMonth;

  const getMonthDetails = (yr: number, mo: number, minusMonths: number) => {
    const d = new Date(yr, mo - 1 - minusMonths, 1);
    const y = d.getFullYear();
    const name = d.toLocaleDateString("id-ID", { month: "short" });
    return { year: y, month: d.getMonth() + 1, name };
  };

  const startInfo = getMonthDetails(targetYear, targetMonth, 2);
  const endInfo = getMonthDetails(targetYear, targetMonth, 0);

  const rangeLabel = `${startInfo.name} ${startInfo.year} - ${endInfo.name} ${endInfo.year}`;

  return {
    period: chosenPeriodNum,
    rangeLabel,
  };
}
