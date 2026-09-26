#!/usr/bin/env python3
"""Genera el catálogo ficticio del Copiloto de Continuidad (JSON para la app y CSV para Google Sheets).

Todo el contenido es inventado: servicios, responsables (buzones de rol en el dominio reservado
.example), cifras y escenarios. Está calibrado para que el pack TRAMONTANA sea coherente:
con E3 + E6 declarados quedan expuestos 26 servicios, RTO mínimo de 2 h y 8.809,82 €/h.

Uso:  python3 tools/generar_catalogo.py
"""
import csv
import json
import os

ROOT = os.path.join(os.path.dirname(__file__), '..', 'copiloto', 'data')
PLANTILLA = os.path.join(ROOT, 'plantilla')

PROB = {0: 'Nula (0%)', 25: 'Baja (25%)', 50: 'Media (50%)', 75: 'Alta (75%)', 100: 'Muy alta (100%)'}
IMPACTO = {'C': 'Crítico', 'A': 'Alto', 'M': 'Medio', 'B': 'Bajo'}

# código, nombre, unidad, modalidad, responsable (buzón de rol), RTO h, RPO h, MTPD h, €/h, impacto,
# exposición E1..E7 (%), justificación reputacional
SERVICIOS = [
    ('SRV-001', 'SOC gestionado 24x7', 'Servicios gestionados', 'Continua 24x7', 'Jefatura SOC', 2, 0.25, 8, 950, 'C', (25, 75, 100, 25, 75, 100, 50), 'Servicio insignia; su caída es visible para toda la cartera de clientes.'),
    ('SRV-002', 'Detección y respuesta gestionada (MDR)', 'Servicios gestionados', 'Continua 24x7', 'Jefatura MDR', 2, 0.25, 8, 900, 'C', (25, 75, 100, 25, 75, 100, 50), 'Compromiso contractual de respuesta en minutos.'),
    ('SRV-003', 'Plataforma ATENEA de gestión de agentes', 'Plataformas', 'Continua 24x7', 'Responsable de plataforma', 2, 0.5, 6, 850, 'C', (0, 50, 100, 0, 100, 100, 50), 'Plataforma central de la que dependen los servicios gestionados.'),
    ('SRV-004', 'Monitorización para operadores esenciales', 'Servicios gestionados', 'Continua 24x7', 'Jefatura SOC', 2, 0.25, 8, 760, 'C', (25, 75, 100, 25, 75, 100, 25), 'Clientes sujetos a obligaciones de operador esencial.'),
    ('SRV-005', 'Respuesta a incidentes (retainer)', 'Respuesta', 'Bajo demanda', 'Coordinación de respuesta', 4, 1, 12, 540, 'A', (25, 75, 75, 25, 50, 100, 50), 'Clientes con contrato de disponibilidad garantizada.'),
    ('SRV-006', 'SIEM gestionado', 'Servicios gestionados', 'Continua 24x7', 'Ingeniería SIEM', 4, 0.5, 12, 500, 'A', (0, 50, 100, 0, 100, 100, 25), 'Pérdida de visibilidad sobre eventos de clientes.'),
    ('SRV-007', 'Gestión de vulnerabilidades', 'Servicios gestionados', 'Laborable', 'Responsable de vulnerabilidades', 24, 24, 72, 180, 'M', (25, 50, 75, 25, 50, 75, 25), 'Retrasos tolerables si se comunican.'),
    ('SRV-008', 'Inteligencia de amenazas', 'Inteligencia', 'Laborable', 'Responsable de inteligencia', 24, 24, 72, 95, 'M', (25, 50, 75, 25, 50, 75, 25), 'Informes periódicos con margen de entrega.'),
    ('SRV-009', 'Gestión de EDR de clientes', 'Servicios gestionados', 'Continua 24x7', 'Ingeniería de endpoint', 4, 1, 12, 420, 'A', (0, 50, 100, 0, 75, 100, 50), 'El agente distribuido es el vector del incidente.'),
    ('SRV-010', 'Gestión de cortafuegos', 'Servicios gestionados', 'Continua 24x7', 'Ingeniería de red', 4, 4, 24, 350, 'A', (0, 50, 75, 0, 75, 75, 50), 'Cambios de configuración bloqueados durante la crisis.'),
    ('SRV-011', 'Protección de correo', 'Servicios gestionados', 'Continua 24x7', 'Ingeniería de correo', 8, 4, 24, 210, 'M', (0, 25, 75, 0, 75, 75, 50), 'Degradación perceptible pero con alternativas.'),
    ('SRV-012', 'Gestión de identidades de clientes', 'Servicios gestionados', 'Laborable', 'Ingeniería de identidad', 8, 4, 24, 260, 'A', (0, 50, 75, 0, 75, 100, 25), 'Acceso de clientes a sus propios sistemas.'),
    ('SRV-013', 'Auditoría técnica y pruebas de intrusión', 'Consultoría', 'Proyecto', 'Dirección de auditoría', 72, 24, 240, 70, 'B', (50, 50, 25, 50, 25, 75, 25), 'Proyectos reprogramables.'),
    ('SRV-014', 'Portal de clientes', 'Plataformas', 'Continua 24x7', 'Responsable de portal', 8, 4, 24, 150, 'A', (0, 25, 100, 0, 75, 75, 50), 'Canal principal de información a clientes.'),
    ('SRV-015', 'Web corporativa y canal público de avisos', 'Comunicación', 'Continua 24x7', 'Comunicación corporativa', 12, 24, 48, 12, 'A', (0, 25, 75, 0, 50, 75, 50), 'Pérdida casi nula por hora, pero máxima visibilidad externa durante la crisis.'),
    ('SRV-016', 'Copias de seguridad gestionadas', 'Servicios gestionados', 'Continua 24x7', 'Ingeniería de backup', 8, 24, 48, 300, 'A', (0, 25, 75, 0, 75, 100, 50), 'Clientes dependen de ellas para recuperarse.'),
    ('SRV-017', 'Continuidad para sector público (ENS Alta)', 'Sector público', 'Continua 24x7', 'Responsable de sector público', 2, 0.5, 8, 690, 'C', (25, 75, 100, 25, 75, 100, 25), 'Organismos con obligaciones ENS categoría Alta.'),
    ('SRV-018', 'Centro de atención de seguridad', 'Atención', 'Continua 24x7', 'Jefatura de atención', 4, 1, 12, 240, 'M', (75, 75, 75, 75, 50, 75, 25), 'Primer punto de contacto de los clientes.'),
    ('SRV-019', 'Análisis forense', 'Respuesta', 'Bajo demanda', 'Laboratorio forense', 24, 4, 72, 160, 'M', (50, 50, 50, 50, 25, 75, 50), 'Capacidad interna saturada durante el incidente.'),
    ('SRV-020', 'Ciberejercicios y formación a clientes', 'Consultoría', 'Proyecto', 'Dirección de formación', 168, 72, 336, 40, 'B', (75, 50, 25, 75, 25, 75, 25), 'Sin impacto relevante a corto plazo.'),
    ('SRV-021', 'Gestión de parches de clientes', 'Servicios gestionados', 'Laborable', 'Ingeniería de sistemas', 24, 24, 72, 130, 'M', (0, 50, 100, 0, 75, 100, 25), 'Despliegues congelados durante la crisis.'),
    ('SRV-022', 'Monitorización de entornos industriales', 'Servicios gestionados', 'Continua 24x7', 'Jefatura OT', 4, 1, 12, 410, 'A', (25, 75, 75, 25, 50, 100, 25), 'Clientes industriales con procesos críticos.'),
    ('SRV-023', 'Cumplimiento y reporting regulatorio', 'Consultoría', 'Laborable', 'Oficina de cumplimiento', 48, 24, 120, 90, 'M', (25, 50, 75, 25, 50, 75, 25), 'Entregables con fecha regulatoria.'),
    ('SRV-024', 'Consultoría de gobierno, riesgo y cumplimiento', 'Consultoría', 'Proyecto', 'Dirección de consultoría', 72, 24, 240, 60, 'B', (50, 50, 25, 50, 25, 75, 25), 'Proyectos reprogramables.'),
    ('SRV-025', 'Gestión de certificados y PKI', 'Plataformas', 'Continua 24x7', 'Ingeniería PKI', 8, 4, 24, 170, 'A', (0, 25, 75, 0, 75, 100, 25), 'Certificado corporativo usado para firmar el binario malicioso.'),
    ('SRV-026', 'Infraestructura interna y directorio corporativo', 'Sistemas internos', 'Continua 24x7', 'Sistemas internos', 4, 1, 12, None, 'C', (50, 50, 100, 25, 100, 100, 25), 'Soporta accesos, correo y control físico de la sede.'),
    # No expuestos (< 75 %) a E3/E6
    ('SRV-027', 'Facturación', 'Administración', 'Laborable', 'Administración', 48, 24, 120, 80, 'M', (25, 25, 50, 25, 50, 50, 25), 'Retrasos de cobro asumibles.'),
    ('SRV-028', 'Nóminas y personas', 'Personas', 'Laborable', 'Área de personas', 72, 24, 168, 40, 'B', (25, 50, 50, 25, 50, 50, 50), 'Ciclo mensual.'),
    ('SRV-029', 'Recepción y control de accesos físicos', 'Instalaciones', 'Laborable', 'Seguridad física', 8, 24, 24, 30, 'M', (100, 50, 50, 50, 25, 50, 25), 'Integrado con el directorio corporativo.'),
    ('SRV-030', 'Comercial y preventa', 'Negocio', 'Laborable', 'Dirección comercial', 72, 24, 168, 110, 'B', (50, 50, 25, 50, 25, 50, 25), 'Oportunidades aplazables.'),
    ('SRV-031', 'Compras y proveedores', 'Administración', 'Laborable', 'Compras', 72, 24, 168, 25, 'B', (25, 25, 25, 25, 25, 25, 75), 'Dependiente de terceros.'),
    ('SRV-032', 'Formación interna', 'Personas', 'Laborable', 'Área de personas', 168, 72, 336, 10, 'B', (75, 50, 25, 75, 25, 25, 25), 'Sin impacto relevante.'),
    ('SRV-033', 'Comunicación interna', 'Comunicación', 'Laborable', 'Comunicación corporativa', 24, 24, 72, 20, 'M', (50, 50, 50, 50, 25, 50, 25), 'Canal hacia la plantilla.'),
    ('SRV-034', 'Mantenimiento de instalaciones', 'Instalaciones', 'Laborable', 'Instalaciones', 72, 72, 168, 15, 'B', (75, 25, 0, 75, 0, 25, 50), 'Sin impacto directo en clientes.'),
    ('SRV-035', 'Asesoría jurídica', 'Legal', 'Laborable', 'Asesoría jurídica', 48, 24, 120, 35, 'M', (25, 75, 25, 25, 25, 50, 25), 'Crítica para notificaciones, no para operación.'),
    ('SRV-036', 'Contabilidad', 'Administración', 'Laborable', 'Administración', 72, 24, 168, 45, 'B', (25, 25, 50, 25, 50, 50, 25), 'Cierre mensual.'),
    ('SRV-037', 'Atención telefónica a clientes', 'Atención', 'Laborable', 'Jefatura de atención', 8, 4, 24, 150, 'A', (75, 50, 25, 75, 25, 50, 75), 'Canal de reclamaciones.'),
    ('SRV-038', 'Laboratorio de I+D', 'Innovación', 'Laborable', 'Dirección de innovación', 72, 24, 240, 20, 'B', (25, 25, 50, 25, 75, 50, 25), 'Proyectos internos.'),
    ('SRV-039', 'Centro de datos de respaldo (proveedor)', 'Infraestructura', 'Continua 24x7', 'Gestión de proveedores', 12, 4, 48, 200, 'A', (0, 0, 50, 0, 50, 50, 100), 'Proveedor externo de alojamiento.'),
    ('SRV-040', 'Conectividad WAN (proveedor)', 'Infraestructura', 'Continua 24x7', 'Gestión de proveedores', 4, 1, 12, 330, 'A', (0, 0, 50, 0, 50, 50, 100), 'Proveedor externo de comunicaciones.'),
]

OBJETIVO_PERDIDA_E3_E6 = 8809.82

ESCENARIOS = [
    ('E1', 'Imposibilidad de acceso físico al puesto de trabajo', 'general', 1, 'Acceso restringido parcial durante menos de una jornada', 'Sede inaccesible durante una jornada completa', 'Sede inaccesible varios días o sin fecha de recuperación'),
    ('E2', 'Ausencia de personal clave', 'personas', 1, 'Ausencias puntuales cubiertas por suplentes', 'Falta de varios perfiles clave sin suplente inmediato', 'Ausencia masiva o de responsables sin sustitución posible'),
    ('E3', 'Incapacidad de acceso a los sistemas de información', 'general', 2, 'Degradación parcial de sistemas no críticos', 'Pérdida de sistemas relevantes con alternativa manual', 'Pérdida generalizada de sistemas críticos sin alternativa'),
    ('E4', 'Incapacidad de desplazamiento a las instalaciones', 'general', 1, 'Dificultades puntuales de desplazamiento', 'Desplazamiento imposible para parte de la plantilla', 'Desplazamiento imposible para la mayoría durante días'),
    ('E5', 'Error en los sistemas', 'general', 1, 'Fallo acotado con recuperación en horas', 'Fallo que afecta a varios servicios', 'Fallo generalizado que exige activar la recuperación'),
    ('E6', 'Acción hostil', 'hostil', 2, 'Indicios de actividad hostil sin impacto confirmado', 'Actividad hostil confirmada con impacto acotado', 'Compromiso confirmado con impacto extendido o desconocido'),
    ('E7', 'Indisponibilidad de proveedores críticos', 'proveedor', 1, 'Degradación de un proveedor con alternativa', 'Caída de un proveedor crítico durante horas', 'Caída prolongada de proveedores críticos sin alternativa'),
]

ESTRATEGIAS = [
    ('EST01', 'Localización alternativa', 'Teletrabajo, otras instalaciones, salas de respaldo u hoteles.'),
    ('EST02', 'Refuerzo con otras áreas', 'Dedicación de personal de otras áreas a las actividades interrumpidas.'),
    ('EST03', 'Escalado al equipo de gestión de incidentes', 'Escalado y decisión del equipo de gestión de incidentes de primer nivel.'),
    ('EST04', 'No hacer nada', 'Solo para actividades no críticas y bajo criterio expreso; debe evaluarse y descartarse explícitamente.'),
    ('EST05', 'Recuperación tecnológica', 'Recuperación de la infraestructura tecnológica y/o activación del plan de recuperación (DRP).'),
    ('EST06', 'Subcontratación alternativa', 'Cobertura temporal o sustitución externa de capacidad.'),
    ('EST07', 'Teletrabajo desde domicilio', 'Cambio temporal del modelo de prestación para sostener la operación.'),
    ('EST08', 'Recuperación reforzada', 'Recuperación tecnológica reforzada para escenario hostil: reconstrucción desde imagen validada en red segregada.'),
]
ESCENARIO_ESTRATEGIAS = {
    'E1': ['EST01', 'EST02', 'EST03', 'EST04'],
    'E2': ['EST02', 'EST03', 'EST06'],
    'E3': ['EST01', 'EST02', 'EST03', 'EST04', 'EST05'],
    'E4': ['EST07', 'EST02', 'EST03'],
    'E5': ['EST05', 'EST04'],
    'E6': ['EST05', 'EST08', 'EST03'],
    'E7': ['EST03', 'EST06'],
}
ICONOS = {'E1': '🏢', 'E2': '👥', 'E3': '🖥️', 'E4': '🚧', 'E5': '⚙️', 'E6': '🛡️', 'E7': '🔗'}
PATRONES = {
    'E1': 'Disrupción física con necesidad de recolocar capacidad operativa.',
    'E2': 'Riesgo de cuello de botella humano en actividades críticas.',
    'E3': 'Bloqueo tecnológico con presión directa sobre tiempo y datos.',
    'E4': 'Restricción logística con necesidad de operar en remoto o en alternativo.',
    'E5': 'Fallo técnico con foco en recuperación de infraestructura.',
    'E6': 'Amenaza hostil con necesidad de gobierno temprano y recuperación robusta.',
    'E7': 'Dependencia externa comprometiendo la continuidad del servicio.',
}


def horas(h):
    return ('%g' % h).replace('.', ',')


def slug(texto):
    import unicodedata
    t = unicodedata.normalize('NFD', texto.lower())
    t = ''.join(c for c in t if unicodedata.category(c) != 'Mn')
    return '.'.join(p for p in ''.join(c if c.isalnum() else ' ' for c in t).split()[:3])


def main():
    os.makedirs(PLANTILLA, exist_ok=True)
    expuestos = [s for s in SERVICIOS if s[10][2] >= 75 or s[10][5] >= 75]
    fijos = sum(s[8] for s in expuestos if s[8] is not None)
    ajuste = round(OBJETIVO_PERDIDA_E3_E6 - fijos, 2)
    assert ajuste > 0, ajuste

    servicios = []
    for i, (cod, nombre, bu, modalidad, resp, rto, rpo, mtpd, perdida, imp, expo, just) in enumerate(SERVICIOS, start=1):
        perdida = ajuste if perdida is None else perdida
        fila = {
            'idactivo': str(1000 + i),
            'codigo': cod,
            'nombre': nombre,
            'descripcion': nombre,
            'n_modalidad': modalidad,
            'n_bu_relacionada': bu,
            'n_responsable': '%s (%s@compania.example)' % (resp, slug(resp)),
            'clasificacion_896': '',
            'n_estado': 'En producción',
            'mbco': 'Servicio mínimo acordado',
            'mtpd': horas(mtpd),
            'rpo': horas(rpo),
            'rto': horas(rto),
            'impactoreputacional': IMPACTO[imp],
            'justifimpactoreputacional': just,
            'perdidah': ('%.2f' % perdida).replace('.', ','),
        }
        for n, p in enumerate(expo, start=1):
            fila['e%d' % n] = PROB[p]
        servicios.append(fila)

    escenarios = [{
        'idactivo': str(2000 + i), 'codigo': c, 'nombre': '%s - %s' % (c, n), 'idnodoabs': '',
        'tipo_calculo': t, 'activo': '1', 'nivel_base': str(b), 'nivel_comite': '3', 'umbral_prob_servicio': '75',
        'categoria_1': c1, 'categoria_2': c2, 'categoria_3': c3,
    } for i, (c, n, t, b, c1, c2, c3) in enumerate(ESCENARIOS, start=1)]

    est_idx = {e[0]: (str(3000 + i), e) for i, e in enumerate(ESTRATEGIAS, start=1)}
    estrategias = {esc: [{'id': est_idx[c][0], 'codigo': c, 'nombre': '%s-%s' % (c, est_idx[c][1][1]), 'descripcion': est_idx[c][1][2]}
                         for c in sorted(codes)] for esc, codes in ESCENARIO_ESTRATEGIAS.items()}

    config = {
        'lead_name': 'Responsable de Continuidad',
        'lead_role': 'Coordinación inicial de continuidad',
        'lead_email': 'continuidad@compania.example',
        'operator_label': 'Operador del panel',
        'umbral_perdida_eur': 5000,
        'umbral_criticos_mtpd': 1,
        'umbral_prob_pct': 75,
        'history_limit': 20,
        'links': {
            'team_directory': 'docs/directorio-equipo.html',
            'continuity_plan': 'docs/plan-gestion-incidentes.html',
            'estrategia_recuperacion': 'docs/estrategia-recuperacion.html',
        },
        'sheets': {'servicios': '', 'escenarios': '', 'estrategias': ''},
        'scenarios': {c: {'title': n, 'short': n, 'icon': ICONOS[c], 'pattern': PATRONES[c], 'strategies': ESCENARIO_ESTRATEGIAS[c]}
                      for c, n, *_ in ESCENARIOS},
        'strategies': {c: {'title': t, 'detail': d} for c, t, d in ESTRATEGIAS},
    }

    def dump(name, obj):
        with open(os.path.join(ROOT, name), 'w', encoding='utf-8') as f:
            json.dump(obj, f, ensure_ascii=False, indent=2)
            f.write('\n')

    dump('servicios.json', servicios)
    dump('escenarios.json', escenarios)
    dump('estrategias.json', estrategias)
    dump('config.json', config)

    def csv_out(name, rows, fields):
        with open(os.path.join(PLANTILLA, name), 'w', encoding='utf-8', newline='') as f:
            w = csv.DictWriter(f, fieldnames=fields)
            w.writeheader()
            w.writerows(rows)

    csv_out('servicios.csv', servicios, list(servicios[0].keys()))
    csv_out('escenarios.csv', escenarios, list(escenarios[0].keys()))
    csv_out('estrategias.csv', [{'escenario': e, **s} for e, lst in estrategias.items() for s in lst],
            ['escenario', 'id', 'codigo', 'nombre', 'descripcion'])
    print('Servicios: %d · expuestos E3/E6: %d · ajuste SRV-026: %.2f €/h' % (len(servicios), len(expuestos), ajuste))


if __name__ == '__main__':
    main()
