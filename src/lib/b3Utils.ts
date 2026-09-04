export function getB3PeriodInfo(poaPeriod: string) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  // Bulan terakhir yang sudah selesai (closed month) relatif ke tanggal saat ini
  let latestClosedYear = currentYear;
  let latestClosedMonth = currentMonth - 1;
  if (latestClosedMonth < 1) {
    latestClosedMonth = 12;
    latestClosedYear -= 1;
  }
  const latestClosedPeriod = latestClosedYear * 100 + latestClosedMonth;

  let targetYear = currentYear;
  let targetMonth = currentMonth;

  if (poaPeriod) {
    if (poaPeriod.includes("-Q")) {
      const [yrStr, qStr] = poaPeriod.split("-Q");
      targetYear = parseInt(yrStr, 10) || currentYear;
      const q = parseInt(qStr, 10) || 1;
      const startMonthOfQ = (q - 1) * 3 + 1; // Q1 -> 1 (Jan), Q2 -> 4 (Apr), Q3 -> 7 (Jul), Q4 -> 10 (Oct)
      // Bulan sebelum kuartal dimulai
      targetMonth = startMonthOfQ - 1;
      if (targetMonth < 1) {
        targetMonth = 12;
        targetYear -= 1;
      }
    } else if (poaPeriod.length === 6) {
      targetYear = parseInt(poaPeriod.slice(0, 4), 10) || currentYear;
      const pMonth = parseInt(poaPeriod.slice(4, 6), 10) || currentMonth;
      targetMonth = pMonth - 1;
      if (targetMonth < 1) {
        targetMonth = 12;
        targetYear -= 1;
      }
    }
  }

  const periodBeforePOA = targetYear * 100 + targetMonth;
  // B3 tidak boleh mengambil data bulan berjalan / masa depan
  const chosenPeriodNum = Math.min(periodBeforePOA, latestClosedPeriod);

  const chosenYear = Math.floor(chosenPeriodNum / 100);
  const chosenMonth = chosenPeriodNum % 100;

  const getMonthDetails = (yr: number, mo: number, minusMonths: number) => {
    const d = new Date(yr, mo - 1 - minusMonths, 1);
    const y = d.getFullYear();
    const name = d.toLocaleDateString("id-ID", { month: "short" });
    return { year: y, month: d.getMonth() + 1, name };
  };

  const startInfo = getMonthDetails(chosenYear, chosenMonth, 2);
  const endInfo = getMonthDetails(chosenYear, chosenMonth, 0);

  const rangeLabel = `${startInfo.name} ${startInfo.year} - ${endInfo.name} ${endInfo.year}`;

  return {
    period: chosenPeriodNum,
    rangeLabel,
  };
}

export function getB3ByQuarter(poaPeriod: string) {
  const now = new Date();
  const currentYear = now.getFullYear();
  const currentMonth = now.getMonth() + 1; // 1-12

  const currentQuarter = Math.ceil(currentMonth / 3);

  // Kuartal terakhir yang sudah selesai (closed quarter)
  let latestClosedQYear = currentYear;
  let latestClosedQuarter = currentQuarter - 1;
  if (latestClosedQuarter < 1) {
    latestClosedQuarter = 4;
    latestClosedQYear -= 1;
  }
  const latestClosedQEndMonth = latestClosedQuarter * 3;
  const latestClosedQPeriod = latestClosedQYear * 100 + latestClosedQEndMonth;

  let poaYear = currentYear;
  let poaQuarter = currentQuarter;

  if (poaPeriod) {
    if (poaPeriod.includes("-Q")) {
      const [yrStr, qStr] = poaPeriod.split("-Q");
      poaYear = parseInt(yrStr, 10) || currentYear;
      poaQuarter = parseInt(qStr, 10) || poaQuarter;
    } else if (poaPeriod.length >= 6) {
      const cleanPeriod = poaPeriod.replace(/[^0-9]/g, "");
      poaYear = parseInt(cleanPeriod.slice(0, 4), 10) || currentYear;
      const pMonth = parseInt(cleanPeriod.slice(4, 6), 10) || currentMonth;
      poaQuarter = Math.ceil(pMonth / 3);
    }
  }

  // B-3 selalu 3 bulan dari quarter sebelumnya (bukan dari periode awal pilihan POA)
  let prevQuarter = poaQuarter - 1;
  let prevQYear = poaYear;
  if (prevQuarter < 1) {
    prevQuarter = 4;
    prevQYear -= 1;
  }

  // Bulan akhir dari quarter sebelumnya (Q1 -> 3, Q2 -> 6, Q3 -> 9, Q4 -> 12)
  const targetEndMonth = prevQuarter * 3;
  const targetPeriod = prevQYear * 100 + targetEndMonth;

  // Jika target kuartal belum ada / belum selesai (masa depan), otomatis ambil kuartal selesai terakhir (misal Q2 2026)
  const chosenPeriodNum = Math.min(targetPeriod, latestClosedQPeriod);

  const chosenYear = Math.floor(chosenPeriodNum / 100);
  const chosenMonth = chosenPeriodNum % 100;

  const getMonthDetails = (yr: number, mo: number, minusMonths: number) => {
    const d = new Date(yr, mo - 1 - minusMonths, 1);
    const y = d.getFullYear();
    const name = d.toLocaleDateString("id-ID", { month: "short" });
    return { year: y, month: d.getMonth() + 1, name };
  };

  const startInfo = getMonthDetails(chosenYear, chosenMonth, 2);
  const endInfo = getMonthDetails(chosenYear, chosenMonth, 0);

  const rangeLabel = `${startInfo.name} ${startInfo.year} - ${endInfo.name} ${endInfo.year}`;

  const targetPeriods: number[] = [];
  for (let i = 2; i >= 0; i--) {
    const d = new Date(chosenYear, chosenMonth - 1 - i, 1);
    const y = d.getFullYear();
    const m = d.getMonth() + 1;
    targetPeriods.push(y * 100 + m);
  }

  return {
    period: chosenPeriodNum,
    rangeLabel,
    targetPeriods,
  };
}

export const b3ByQuarter = getB3ByQuarter;

