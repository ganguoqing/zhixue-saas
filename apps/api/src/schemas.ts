import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import Ajv2020, { type ErrorObject, type ValidateFunction } from 'ajv/dist/2020';
import addFormats from 'ajv-formats';

const root = join(__dirname, '../../../docs/architecture/schemas');
const payloadSchema = JSON.parse(readFileSync(join(root, 'model-grade-payload-1.0.0.schema.json'), 'utf8')) as {
  $id: string;
};
const envelopeSchema = JSON.parse(readFileSync(join(root, 'acceptance-envelope-1.0.0.schema.json'), 'utf8')) as {
  $id: string;
};

const ajv = new Ajv2020({
  strict: true,
  strictRequired: false,
  allErrors: true,
  removeAdditional: false,
});
addFormats(ajv);
ajv.addSchema(payloadSchema);
ajv.addSchema(envelopeSchema);

function validator(id: string): ValidateFunction {
  const compiled = ajv.getSchema(id);
  if (!compiled) throw new Error(`missing schema ${id}`);
  return compiled;
}

export const validateEnvelope = validator(envelopeSchema.$id);
export const validatePayload = validator(payloadSchema.$id);

export function schemaErrors(validate: ValidateFunction): string {
  return (validate.errors ?? []).map((error: ErrorObject) => `${error.instancePath} ${error.message}`).join('; ');
}
