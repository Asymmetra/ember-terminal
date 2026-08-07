export interface SerializedInstruction {
  program_id: string;
  accounts: SerializedAccountMeta[];
  data: string;
}

export interface SerializedAccountMeta {
  pubkey: string;
  is_signer: boolean;
  is_writable: boolean;
}

export interface TxResponse {
  instructions: SerializedInstruction[];
}
