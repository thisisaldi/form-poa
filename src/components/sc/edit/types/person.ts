export interface SalesCounterPerson {
  id: string;
  outletPersonId?: string;
  nik_ktp: string;
  personName: string;
  positionName: string;
  tipeUploadSc?: string;
}

export type Person = SalesCounterPerson;
