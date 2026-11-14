import type { Grading } from './schema';

// A ready-made participation rubric, written for Sessional: schools start from it and change any
// part. Short buttons with points, a sentence explaining each level, in English and Spanish.

const lv = (key: string, en: string, es: string, points: number, den: string, des: string) => ({ key, label: { en, es }, description: { en: den, es: des }, points });

export function standardGrading(): Grading {
  return {
    enabled: true,
    categories: [
      {
        key: 'speech',
        name: { en: 'Speech', es: 'Discurso' },
        short: 'SP',
        hint: { en: 'A speech from the speakers list, with its answers to questions.', es: 'Un discurso de la lista de oradores, con sus respuestas a preguntas.' },
        weight: 1,
        levels: [
          lv('excellent', 'Excellent', 'Excelente', 5, 'Clear, well argued and true to the country; answers questions with confidence.', 'Claro, bien argumentado y fiel al país; responde preguntas con seguridad.'),
          lv('good', 'Good', 'Bueno', 4, 'Clear and on topic, with some gaps in argument or answers.', 'Claro y pertinente, con algunas lagunas en los argumentos o las respuestas.'),
          lv('fair', 'Fair', 'Regular', 3, 'Understandable but general; proposals are vague.', 'Comprensible pero general; las propuestas son vagas.'),
          lv('weak', 'Weak', 'Débil', 1, 'Unclear or off topic; questions are avoided.', 'Poco claro o fuera de tema; evita las preguntas.'),
        ],
      },
      {
        key: 'question',
        name: { en: 'Question', es: 'Pregunta' },
        short: 'Q',
        hint: { en: 'A question asked to a speaker.', es: 'Una pregunta hecha a un orador.' },
        weight: 1,
        levels: [
          lv('sharp', 'Sharp', 'Precisa', 3, 'Well built, moves the debate forward.', 'Bien construida, hace avanzar el debate.'),
          lv('relevant', 'Relevant', 'Pertinente', 2, 'On topic and clear.', 'Pertinente y clara.'),
          lv('weak', 'Weak', 'Débil', 1, 'Unclear or unrelated.', 'Poco clara o sin relación.'),
        ],
      },
      {
        key: 'moderated',
        name: { en: 'Moderated caucus', es: 'Debate moderado' },
        short: 'MC',
        hint: { en: 'Each contribution in a moderated caucus.', es: 'Cada intervención en un debate moderado.' },
        weight: 1,
        levels: [
          lv('new', 'New idea', 'Idea nueva', 3, 'Brings new information or a concrete proposal.', 'Aporta información nueva o una propuesta concreta.'),
          lv('builds', 'Builds on', 'Desarrolla', 2, 'Improves ideas already on the table.', 'Mejora ideas que ya están sobre la mesa.'),
          lv('little', 'Little', 'Poco', 1, 'Repeats or adds little.', 'Repite o aporta poco.'),
        ],
      },
      {
        key: 'unmoderated',
        name: { en: 'Unmoderated caucus', es: 'Debate no moderado' },
        short: 'UMC',
        hint: { en: 'Work in an unmoderated caucus, once per caucus.', es: 'Trabajo en un debate no moderado, una vez por debate.' },
        weight: 1,
        levels: [
          lv('leads', 'Leads', 'Lidera', 3, 'Leads a group and drives its proposals.', 'Lidera un grupo e impulsa sus propuestas.'),
          lv('active', 'Active', 'Activo', 2, 'Takes part and helps organise ideas.', 'Participa y ayuda a organizar ideas.'),
          lv('passive', 'Passive', 'Pasivo', 1, 'Present but contributes little.', 'Presente pero aporta poco.'),
        ],
      },
      {
        key: 'papers',
        name: { en: 'Papers', es: 'Documentos' },
        short: 'DOC',
        hint: { en: 'Writing and presenting working papers and draft resolutions.', es: 'Redacción y presentación de documentos de trabajo y proyectos de resolución.' },
        weight: 1,
        levels: [
          lv('author', 'Main author', 'Autor principal', 5, 'Wrote much of the text and defended it.', 'Redactó gran parte del texto y lo defendió.'),
          lv('contributor', 'Contributor', 'Colaborador', 3, 'Wrote or improved parts of it.', 'Redactó o mejoró partes del texto.'),
          lv('signatory', 'Signatory', 'Signatario', 1, 'Supported it without writing.', 'Lo apoyó sin redactar.'),
        ],
      },
    ],
    bonuses: [{ key: 'explanation', name: { en: 'Explanation of vote', es: 'Explicación de voto' }, source: 'vote_explanation', points: 1 }],
    scale: { kind: 'points', max: 100, letters: [] },
    awards: [
      { key: 'best', name: { en: 'Best Delegate', es: 'Mejor Delegado' }, count: 1, rule: 'top_total' },
      { key: 'outstanding', name: { en: 'Outstanding Delegate', es: 'Delegado Sobresaliente' }, count: 1, rule: 'top_total' },
      { key: 'mention', name: { en: 'Honourable Mention', es: 'Mención Honorífica' }, count: 2, rule: 'top_total' },
      { key: 'position_paper', name: { en: 'Best Position Paper', es: 'Mejor Documento de Posición' }, count: 1, rule: 'manual' },
    ],
  };
}
