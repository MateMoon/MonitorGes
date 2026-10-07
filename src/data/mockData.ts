// Datos ficticios exclusivos de la demo. Se reemplazar?n por respuestas de la API.
import { TODAY, statusFor, type Status } from '../data';
import type { Garantia, Importacion, Notificacion, Usuario } from '../types';

const addDays = (d: Date, n: number) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n)

export const RESPONSABLES = ['Centro de Salud Rural Pitrufquén']
export const PROBLEMAS = [
  'Alzheimer y Otras Demencias · Decreto Nro 22/2019',
  'Cáncer Cervicouterino Segmento Proceso de Diagnóstico · Decreto Nº 228',
  'Displasia Luxante de Caderas · Decreto N° 1/2010',
  'Salud Oral de la Embarazada · Decreto N° 1/2010',
  'Tratamiento Erradicación HELICOBACTER PYLORI · Decreto N° 4/2013',
]
const GARANTIAS = ['Tamizaje PAP', 'Tratamiento', 'Alta Integral', 'Screning de Radiografía de Caderas']

const NOMBRES = ['Juan', 'Ana', 'Carlos', 'Rosa', 'Mario', 'Elena', 'Jorge', 'Paula', 'Hugo', 'Sofía', 'Diego', 'Marta', 'Felipe', 'Gloria', 'Ramón', 'Inés', 'Óscar', 'Lucía', 'Iván', 'Teresa']
const APELL = ['Pérez', 'González', 'Muñoz', 'Rojas', 'Díaz', 'Soto', 'Contreras', 'Silva', 'Martínez', 'Sepúlveda', 'Morales', 'Fuentes', 'Vargas', 'Reyes', 'Castro', 'Tapia']

function dv(n: number) {
  let s = 0, m = 2
  for (const c of String(n).split('').reverse()) { s += Number(c) * m; m = m === 7 ? 2 : m + 1 }
  const r = 11 - (s % 11)
  return r === 11 ? '0' : r === 10 ? 'K' : String(r)
}

const OFFSETS = [2, 4, 6, 1, 3, 5, 7, -3, -9, -14, -21, -5, 8, 9, 11, 12, 14, 15, 17, 19, 22, 25, 28, 30, 33, 38, 45, 52, 60, 71, 85, 97, 110, 128, 140, 160, 180, 200, 250, 300]
const FIXED = [
  ['Juan', 'Pérez', 0, 0, 0], ['Ana', 'González', 1, 1, 1], ['Carlos', 'Muñoz', 2, 2, 2],
] as const

export const GARANTIAS_DATA: Garantia[] = OFFSETS.map((dias, i) => {
  const f = FIXED[i]
  const base = 10000000 + ((i * 2654435) % 12000000)
  const num = i === 0 ? 12345678 : i === 1 ? 18456789 : i === 2 ? 19654321 : base
  const limite = addDays(TODAY, dias)
  return {
    id: i + 1,
    rut: String(num).replace(/\B(?=(\d{3})+(?!\d))/g, '.'),
    dv: i === 0 ? '9' : i === 1 ? '3' : i === 2 ? '7' : dv(num),
    nombre: f ? `${f[0]} ${f[1]}` : `${NOMBRES[(i * 7) % NOMBRES.length]} ${APELL[(i * 5) % APELL.length]} ${APELL[(i * 3 + 4) % APELL.length]}`,
    problema: PROBLEMAS[i < 3 ? i : (i * 5) % PROBLEMAS.length],
    garantia: GARANTIAS[i < 3 ? i : (i * 3) % GARANTIAS.length],
    inicio: addDays(limite, -(60 + ((i * 37) % 120))),
    limite,
    dias,
    estado: statusFor(dias),
    responsable: RESPONSABLES[0],
  }
})

export const CONTEOS: Record<Status, number> = { normal: 148, atencion: 32, proxima: 17, critica: 6, vencida: 12 }

export const IMPORTS: Importacion[] = [
  ['06/10/2026 08:32', 'Juan Soto', 'Nomina_06102026.xlsx', 253, 8, 32, 2, 'Completado'],
  ['05/10/2026 08:41', 'María Pérez', 'Nomina_05102026.xlsx', 249, 5, 27, 0, 'Completado'],
  ['02/10/2026 09:05', 'Juan Soto', 'Nomina_02102026.xlsx', 246, 3, 19, 1, 'Completado'],
  ['01/10/2026 08:50', 'María Pérez', 'Nomina_01102026.xlsx', 244, 6, 22, 4, 'Con observaciones'],
  ['30/09/2026 08:37', 'Juan Soto', 'Nomina_30092026.xlsx', 238, 2, 14, 0, 'Completado'],
  ['29/09/2026 10:12', 'Lorena Campos', 'Nomina_29092026.xlsx', 236, 0, 0, 236, 'Fallido'],
  ['28/09/2026 08:44', 'María Pérez', 'Nomina_28092026.xlsx', 236, 7, 31, 0, 'Completado'],
] as const

export const NOTIFS: Notificacion[] = [
  ['07/10/2026', 'Tamizaje PAP', 'Juan Pérez', '7 días', 'responsable@institucion.cl', 'Pendiente'],
  ['06/10/2026', 'Tamizaje PAP', 'Juan Pérez', '7 días', 'centro.salud@institucion.cl', 'Enviado'],
  ['06/10/2026', 'Tratamiento', 'Ana González', '7 días', 'centro.salud@institucion.cl', 'Enviado'],
  ['06/10/2026', 'Resumen diario', '—', 'Resumen', 'jefatura@institucion.cl', 'Enviado'],
  ['06/10/2026', 'Alta Integral', 'Carlos Muñoz', '7 días', 'centro.salud@institucion.cl', 'Enviado'],
  ['06/10/2026', 'Screning de Radiografía de Caderas', 'Rosa Rojas', '1 día después', 'centro.salud@institucion.cl', 'Error'],
  ['05/10/2026', 'Tamizaje PAP', 'Mario Silva', '15 días', 'centro.salud@institucion.cl', 'Enviado'],
  ['05/10/2026', 'Tratamiento', 'Elena Soto', '15 días', 'centro.salud@institucion.cl', 'Enviado'],
  ['05/10/2026', 'Alta Integral', 'Jorge Díaz', 'Vencimiento', 'centro.salud@institucion.cl', 'Error'],
  ['04/10/2026', 'Screning de Radiografía de Caderas', 'Paula Fuentes', '30 días', 'centro.salud@institucion.cl', 'Enviado'],
  ['04/10/2026', 'Resumen diario', '—', 'Resumen', 'jefatura@institucion.cl', 'Enviado'],
  ['03/10/2026', 'Tamizaje PAP', 'Hugo Vargas', '7 días', 'centro.salud@institucion.cl', 'Enviado'],
].map(([fecha, garantia, paciente, tipo, dest, estado]) => ({ fecha, garantia, paciente, tipo, dest, canal: 'Email', estado: estado as 'Enviado' })) as never

export const USUARIOS: Usuario[] = [
  ['Juan Soto', 'jsoto', 'Administrador', 'Activo', '06/10/2026 08:20'],
  ['María Pérez', 'mperez', 'Operador', 'Activo', '05/10/2026 16:48'],
  ['Lorena Campos', 'lcampos', 'Operador', 'Activo', '29/09/2026 10:02'],
  ['Ricardo Núñez', 'rnunez', 'Consulta', 'Activo', '03/10/2026 11:30'],
  ['Valeria Ortiz', 'vortiz', 'Consulta', 'Inactivo', '12/08/2026 09:15'],
] as const
