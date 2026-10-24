// Точная транскрипция предоставленной пользователем таблицы к упражнению № 29.
// Ключ: баллы (100…2); пороги: минимальное количество полных восхождений.
const young100to76 = Array.from({length:25}, (_,i) => 400-2*i);
const old100to76   = [...Array.from({length:24}, (_,i) => 360-2*i), 310];
const young75to51  = [350,348,346,344,342,340,338,336,334,332,330,328,326,324,322,320,318,316,314,310,308,306,304,302,300];
const old75to51    = Array.from({length:25}, (_,i) => 308-2*i);
const young50to26  = Array.from({length:25}, (_,i) => 298-2*i);
const old50to26    = [258,256,254,252,250,248,246,244,242,240,238,236,235,234,233,232,231,230,229,228,227,226,225,224,223];
const young25to2   = [248,246,244,242,240,238,236,234,232,231,230,229,228,227,226,225,224,223,222,221,220,219,218,217];
const old25to2     = Array.from({length:24}, (_,i) => 222-i);
export const NORMS = Object.freeze([
  ...Array.from({length:25},(_,i)=>({score:100-i,young:young100to76[i],older:old100to76[i]})),
  ...Array.from({length:25},(_,i)=>({score:75-i,young:young75to51[i],older:old75to51[i]})),
  ...Array.from({length:25},(_,i)=>({score:50-i,young:young50to26[i],older:old50to26[i]})),
  ...Array.from({length:24},(_,i)=>({score:25-i,young:young25to2[i],older:old25to2[i]}))
].map(Object.freeze));

export function calculateScore(repetitions, group='young') {
  if (!Number.isInteger(repetitions) || repetitions < 0 || !['young','older'].includes(group)) {
    throw new TypeError('Некорректное количество повторений или возрастная категория');
  }
  const reached = NORMS.find(item => repetitions >= item[group]);
  const next = [...NORMS].reverse().find(item => item[group] > repetitions);
  return {
    score: reached?.score ?? null, // в таблице НЕТ оценки ниже 2 баллов
    nextCount: next?.[group] ?? null,
    nextScore: next?.score ?? null,
    minCount: NORMS.at(-1)[group],
    maxCount: NORMS[0][group],
    maxScore: 100
  };
}
