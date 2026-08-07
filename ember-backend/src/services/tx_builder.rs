use base64::Engine;
use serde::Serialize;
use solana_instruction::Instruction;

/// Serialized instruction account for the frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedAccountMeta {
    pub pubkey: String,
    pub is_signer: bool,
    pub is_writable: bool,
}

/// Serialized instruction for the frontend
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SerializedInstruction {
    pub program_id: String,
    pub accounts: Vec<SerializedAccountMeta>,
    pub data: String, // base64-encoded
}

/// Full transaction response
#[derive(Debug, Clone, Serialize)]
pub struct TxResponse {
    pub instructions: Vec<SerializedInstruction>,
    pub message: String,
}

/// Transaction response for isolated limit order — extends TxResponse with
/// the subaccount index that was actually used, so callers can pass the
/// correct `subaccount_index` when cancelling orders on that subaccount.
#[derive(Debug, Clone, Serialize)]
pub struct IsolatedLimitOrderResponse {
    pub instructions: Vec<SerializedInstruction>,
    pub message: String,
    pub subaccount_index: u8,
}

/// Serialize SDK instructions into the frontend-friendly TxResponse format.
pub fn serialize_instructions(instructions: Vec<Instruction>, message: String) -> TxResponse {
    let serialized = instructions
        .into_iter()
        .map(|ix| SerializedInstruction {
            program_id: ix.program_id.to_string(),
            accounts: ix
                .accounts
                .iter()
                .map(|a| SerializedAccountMeta {
                    pubkey: a.pubkey.to_string(),
                    is_signer: a.is_signer,
                    is_writable: a.is_writable,
                })
                .collect(),
            data: base64::engine::general_purpose::STANDARD.encode(&ix.data),
        })
        .collect();

    TxResponse {
        instructions: serialized,
        message,
    }
}
