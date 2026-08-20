export interface SalesCounterPersonModel {
  person_id: number;
  person_name: string;
  ktp_name: string | null;
  phone_number: string;
  position_name: string;
  ktp_image: string | null;
  digital_bank: string;
  bank_account_name: string;
  nik: string;
  status_sc: string;
  skp_documents: {
    document_id: number;
    document_file: string;
    end_periode: number;
  }[];
  alasan_tolak_sc: string | null;
  tipe_upload_sc: string;
}

export interface SalesCounterPersonApiResponse {
  healthyone_branch_code: string;
  data: SalesCounterPersonModel[];
}
