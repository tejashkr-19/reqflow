function getArrayTypeStr(arr) {
  if (!Array.isArray(arr) || arr.length === 0) return 'array';
  const first = arr[0];
  if (first === null) return 'array[null]';
  if (Array.isArray(first)) return 'array[array]';
  return `array[${typeof first}]`;
}

function inferSchema(obj, prefix = '') {
  let schema = {};

  if (obj === undefined) return schema;
  if (obj === null) return 'null';
  if (Array.isArray(obj)) return getArrayTypeStr(obj);
  if (typeof obj !== 'object') return typeof obj;

  const sensitiveFields = ['password', 'token', 'secret', 'key', 'apikey', 'auth'];

  for (const key in obj) {
    if (Object.prototype.hasOwnProperty.call(obj, key)) {
      const value = obj[key];
      
      if (value === undefined) continue;

      const newKey = prefix ? `${prefix}.${key}` : key;
      const isSensitive = sensitiveFields.some(s => key.toLowerCase().includes(s));

      if (isSensitive) {
        schema[newKey] = 'string ⚠️ sensitive';
      } else if (value === null) {
        schema[newKey] = 'null';
      } else if (Array.isArray(value)) {
        schema[newKey] = getArrayTypeStr(value);
      } else if (typeof value === 'object') {
        const nestedSchema = inferSchema(value, newKey);
        Object.assign(schema, nestedSchema);
      } else {
        schema[newKey] = typeof value;
      }
    }
  }

  return schema;
}

function mergeSchema(existingSchema, inferred) {
  if (!existingSchema || !existingSchema.fields) {
    existingSchema = {
      total_observations: 0,
      fields: {}
    };
  }

  existingSchema.total_observations += 1;

  if (typeof inferred === 'string') {
    inferred = { "[root]": inferred };
  }

  for (const [key, type] of Object.entries(inferred)) {
    if (existingSchema.fields[key]) {
      let field = existingSchema.fields[key];
      field.count += 1;
      
      if (field.type !== type && field.type !== 'mixed') {
        field.types_seen = [field.type, type];
        field.type = 'mixed';
      } else if (field.type === 'mixed' && !field.types_seen.includes(type)) {
        field.types_seen.push(type);
      }
    } else {
      existingSchema.fields[key] = {
        type: type,
        count: 1
      };
    }
  }

  return existingSchema;
}

function classifyField(count, totalObservations) {
  if (totalObservations === 0) return 'edge case';
  const freq = (count / totalObservations) * 100;
  
  if (freq === 100) return 'required';
  if (freq >= 50) return 'optional';
  if (freq >= 10) return 'rare';
  return 'edge case';
}

function getConfidenceScore(totalObservations) {
  if (totalObservations <= 1) return 10;
  if (totalObservations >= 100) return 99;

  if (totalObservations <= 10) {
    return Math.round(10 + ((totalObservations - 1) / 9) * 40);
  }
  if (totalObservations <= 50) {
    return Math.round(50 + (totalObservations - 10));
  }
  if (totalObservations < 100) {
    return Math.round(90 + ((totalObservations - 50) / 50) * 9);
  }
}

module.exports = {
  inferSchema,
  mergeSchema,
  classifyField,
  getConfidenceScore
};
