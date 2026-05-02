export interface Persona {
  id: string;
  name: string;
  userAgent: string;
  locale: string;
  timezoneId: string;
  viewport: { width: number; height: number };
  statePath: string; // path to the saved browser context state (cookies, localStorage)
}

import * as path from 'path';
import * as fs from 'fs';
import { app } from 'electron';
import Store from 'electron-store';

export class PersonaManager {
  private store: Store;

  constructor(store: Store) {
    this.store = store;
  }

  getPersonas(): Persona[] {
    return (this.store as any).get('personas', []) as Persona[];
  }

  addPersona(persona: Omit<Persona, 'statePath'>) {
    const personas = this.getPersonas();
    const statePath = path.join(app.getPath('userData'), `persona_${persona.id}.json`);
    const newPersona = { ...persona, statePath };
    personas.push(newPersona);
    (this.store as any).set('personas', personas);
    return newPersona;
  }

  updatePersona(id: string, updates: Partial<Persona>) {
    const personas = this.getPersonas();
    const idx = personas.findIndex(p => p.id === id);
    if (idx !== -1) {
      personas[idx] = { ...personas[idx], ...updates };
      (this.store as any).set('personas', personas);
    }
  }

  deletePersona(id: string) {
    let personas = this.getPersonas();
    const persona = personas.find(p => p.id === id);
    if (persona && fs.existsSync(persona.statePath)) {
      try { fs.unlinkSync(persona.statePath); } catch (e) {}
    }
    personas = personas.filter(p => p.id !== id);
    (this.store as any).set('personas', personas);
  }
}
