import { MAX_ANALYTIC_DATA_BYTES, type AnalyticSectionData } from "./analytic-sections";

/** Field errors are for the form; the API independently validates the full wire contract. */
export function validateAnalyticForm(data: AnalyticSectionData): Record<string, string> {
  const errors: Record<string, string> = {};
  const text = (key: string, value: string, max: number) => {
    if (!value.trim()) errors[key] = "Completa este campo.";
    else if ([...value].length > max) errors[key] = `Usa como máximo ${max} caracteres.`;
    else if (/[\u0000\uD800-\uDFFF]/u.test(value)) errors[key] = "Revisa los caracteres de este campo.";
  };
  text("name", data.name, 200);
  text("grade", data.grade, 80);
  text("period", data.period, 80);
  text("situation", data.situation, 1000);
  data.entries.forEach((entry, index) => {
    text(`content-${index}`, entry.content, 500);
    text(`pda-${index}`, entry.pda, 500);
  });
  if (data.entries.length < 1 || data.entries.length > 8)
    errors.entries = "Incluye de uno a ocho pares de contenido y PDA.";
  if (data.context !== null) text("context", data.context.text, 1000);
  if (data.formative_field !== null) text("formative_field", data.formative_field, 120);
  if (data.articulating_axes.length > 7 || data.articulating_axes.some(axis =>
    !axis.trim() || [...axis].length > 80 || /[\u0000\uD800-\uDFFF]/u.test(axis)))
    errors.articulating_axes = "Escribe hasta siete ejes, uno por línea, de hasta 80 caracteres.";
  text("language", data.language, 40);
  if (new TextEncoder().encode(JSON.stringify(data)).length > MAX_ANALYTIC_DATA_BYTES)
    errors.form = "El apartado supera los 8000 bytes admitidos. Reduce el texto antes de guardar.";
  return errors;
}
