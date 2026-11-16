// The fields of study the school teaches, each with its own example suite
// (tools/test-suite/speciality-<key>.suite.csv). Its examples are seeded beside
// a card's showcase example (seed_examples.cjs --speciality <key>), and travel
// with `speciality: '<key>'` on the job (server/realtime/realtimeBus.js).
// The order is the order a student sees them in.
export const SPECIALITIES = [
    { key: 'scenography', label: 'Scenography' },
    { key: 'interior', label: 'Interior architecture' },
    { key: 'industrial', label: 'Industrial design' },
    { key: 'transportation', label: 'Transportation design' },
    { key: 'uxui', label: 'UX/UI design' },
    { key: 'graphic-motion', label: 'Graphic & motion design' },
];

const LABELS = new Map(SPECIALITIES.map(s => [s.key, s.label]));

/** The label of a speciality key; an unknown key is shown as it is rather than hidden. */
export const specialityLabel = (key) => LABELS.get(key) || key || '';

// The student's own field, remembered in this browser only. Storage can be
// missing or refuse (a private window, blocked site data): then nothing is
// remembered and the page works the same.
const STORE_KEY = 'comfyq.speciality';
export const loadSpeciality = () => {
    try { const v = localStorage.getItem(STORE_KEY); return v && LABELS.has(v) ? v : ''; } catch { return ''; }
};
export const saveSpeciality = (key) => {
    try { if (key) localStorage.setItem(STORE_KEY, key); else localStorage.removeItem(STORE_KEY); } catch { /* not remembered */ }
};

/**
 * A card's speciality examples, the student's own field first, then the order
 * above; each with its label, and a number when one field has several for the
 * same card ("Interior architecture 2").
 */
export const orderSpecialityExamples = (jobs, mine = '') => {
    const rank = (k) => (k === mine ? -1 : SPECIALITIES.findIndex(s => s.key === k));
    const sorted = [...jobs].sort((a, b) => rank(a.speciality) - rank(b.speciality) || (a.time_slot || 0) - (b.time_slot || 0));
    const count = new Map();
    for (const j of sorted) count.set(j.speciality, (count.get(j.speciality) || 0) + 1);
    const seen = new Map();
    return sorted.map(j => {
        const n = (seen.get(j.speciality) || 0) + 1;
        seen.set(j.speciality, n);
        const label = specialityLabel(j.speciality);
        return { job: j, label: count.get(j.speciality) > 1 ? `${label} ${n}` : label, mine: j.speciality === mine };
    });
};
