export interface DummyKompetitorItem {
  kodeProduk: string;
  namaProduk: string;
  subtitel: string;
  zatAktif: string;
  internalSales: {
    healthyOneUb: number;
    b2bSellInUb: number;
  };
  surveyCompetitor: {
    namaKompetitor: string;
    forecastPenjualanKompetitor: string;
    potensiProrisUb: number;
  };
}

export const DUMMY_KOMPETITOR_DATA: DummyKompetitorItem[] = [
  {
    kodeProduk: "0201478",
    namaProduk: "PRORIS SUSP 60 ML RASA JERUK",
    subtitel: "0201478 · PRORIS · Ibuprofen 100mg/5ml",
    zatAktif: "IBUPROFEN",
    internalSales: {
      healthyOneUb: 10,
      b2bSellInUb: 16.67,
    },
    surveyCompetitor: {
      namaKompetitor: "Sanmol Syrup 60ml",
      forecastPenjualanKompetitor: "5 UB",
      potensiProrisUb: 35,
    },
  },
  {
    kodeProduk: "0201784",
    namaProduk: "POLYSILANE SUSPENSI 100 ML",
    subtitel: "0201784 · POLYSILANE · Antasida Doen & Dimethicone",
    zatAktif: "AL(OH)3, MG(OH)2, DIMETHICONE",
    internalSales: {
      healthyOneUb: 18,
      b2bSellInUb: 7.33,
    },
    surveyCompetitor: {
      namaKompetitor: "Mylanta Liquid 150ml",
      forecastPenjualanKompetitor: "8 UB",
      potensiProrisUb: 51,
    },
  },
  {
    kodeProduk: "0202144",
    namaProduk: "MICROLAX 3 X 5 ML",
    subtitel: "0202144 · MICROLAX · Na Lauril Sulfoasetat",
    zatAktif: "NA LAURYL SULFATE, PEG, SORBITOL, NA CITRATE, SORBIC ACID",
    internalSales: {
      healthyOneUb: 8,
      b2bSellInUb: 3.33,
    },
    surveyCompetitor: {
      namaKompetitor: "Dulcolax Suppositoria",
      forecastPenjualanKompetitor: "4 UB",
      potensiProrisUb: 27,
    },
  },
];
