import type { Course } from './types.js'

/** Percurso padrao: 4 buracos curtos, todos medidos em unidades do gramado. */
export const COURSE: Course = {
  id: 'parque',
  name: 'Parque Ensolarado',
  holes: [
    {
      id: 'boas-vindas',
      name: 'Reta de Boas-vindas',
      par: 2,
      outline: [
        { x: -1.5, z: 0 },
        { x: 1.5, z: 0 },
        { x: 1.5, z: 12 },
        { x: -1.5, z: 12 },
      ],
      tee: { x: 0, z: 1.2 },
      cup: { x: 0.7, z: 10.4 },
      blocks: [{ min: { x: -0.9, z: 7.6 }, max: { x: -0.25, z: 8 } }],
      bumpers: [{ x: -0.6, z: 6, r: 0.3 }],
      zones: [],
    },
    {
      id: 'curva-do-l',
      name: 'Curva do L',
      par: 3,
      outline: [
        { x: -1.5, z: 0 },
        { x: 1.5, z: 0 },
        { x: 1.5, z: 8 },
        { x: 9, z: 8 },
        { x: 9, z: 11 },
        { x: -1.5, z: 11 },
      ],
      tee: { x: 0, z: 1.2 },
      cup: { x: 7.5, z: 9.5 },
      blocks: [],
      bumpers: [{ x: 4.5, z: 9, r: 0.3 }],
      zones: [{ kind: 'sand', min: { x: 3.4, z: 10 }, max: { x: 5.6, z: 11 } }],
    },
    {
      id: 'ponte-do-lago',
      name: 'Ponte sobre o Lago',
      par: 3,
      outline: [
        { x: -3, z: 0 },
        { x: 3, z: 0 },
        { x: 3, z: 14 },
        { x: -3, z: 14 },
      ],
      tee: { x: 0, z: 1.2 },
      cup: { x: 1.6, z: 12.4 },
      blocks: [],
      bumpers: [
        { x: -1.2, z: 11, r: 0.35 },
        { x: 0.4, z: 10.3, r: 0.3 },
      ],
      zones: [
        { kind: 'water', min: { x: -3, z: 5 }, max: { x: -0.5, z: 8.5 } },
        { kind: 'water', min: { x: 0.5, z: 5 }, max: { x: 3, z: 8.5 } },
        { kind: 'boost', min: { x: -0.5, z: 5.5 }, max: { x: 0.5, z: 8 }, dir: { x: 0, z: 1 }, strength: 6 },
      ],
    },
    {
      id: 'ladeira-maluca',
      name: 'Ladeira Maluca',
      par: 3,
      outline: [
        { x: -2, z: 0 },
        { x: 2, z: 0 },
        { x: 2, z: 13 },
        { x: -2, z: 13 },
      ],
      tee: { x: 0, z: 1.2 },
      cup: { x: -1, z: 11.6 },
      blocks: [{ min: { x: -0.6, z: 9.8 }, max: { x: 0.6, z: 10.3 } }],
      bumpers: [],
      zones: [
        { kind: 'slope', min: { x: -2, z: 3.5 }, max: { x: 2, z: 9 }, dir: { x: 1, z: 0 }, strength: 2.2 },
        { kind: 'sand', min: { x: 0.8, z: 10.6 }, max: { x: 2, z: 13 } },
      ],
    },
  ],
}

export const COURSE_PAR = COURSE.holes.reduce((sum, hole) => sum + hole.par, 0)
