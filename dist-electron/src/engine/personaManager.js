"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.PersonaManager = void 0;
const path = __importStar(require("path"));
const fs = __importStar(require("fs"));
const electron_1 = require("electron");
class PersonaManager {
    store;
    constructor(store) {
        this.store = store;
    }
    getPersonas() {
        return this.store.get('personas', []);
    }
    addPersona(persona) {
        const personas = this.getPersonas();
        const statePath = path.join(electron_1.app.getPath('userData'), `persona_${persona.id}.json`);
        const newPersona = { ...persona, statePath };
        personas.push(newPersona);
        this.store.set('personas', personas);
        return newPersona;
    }
    updatePersona(id, updates) {
        const personas = this.getPersonas();
        const idx = personas.findIndex(p => p.id === id);
        if (idx !== -1) {
            personas[idx] = { ...personas[idx], ...updates };
            this.store.set('personas', personas);
        }
    }
    deletePersona(id) {
        let personas = this.getPersonas();
        const persona = personas.find(p => p.id === id);
        if (persona && fs.existsSync(persona.statePath)) {
            try {
                fs.unlinkSync(persona.statePath);
            }
            catch (e) { }
        }
        personas = personas.filter(p => p.id !== id);
        this.store.set('personas', personas);
    }
}
exports.PersonaManager = PersonaManager;
