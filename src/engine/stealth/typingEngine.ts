import { type Page } from 'playwright';
import { MouseEngine } from './mouseEngine';

export class TypingEngine {

  static async humanType(page: Page, selector: string, text: string, currentMousePos: { x: number; y: number }): Promise<{ x: number; y: number }> {
    // 1. Click the element with human-like Gaussian targeting
    const newPos = await MouseEngine.humanClickElement(page, selector, currentMousePos);
    
    // 2. Type with variable WPM
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      
      // Calculate micro-delay for this keystroke
      // Normal delay ~ 50-150ms.
      let delay = Math.floor(Math.random() * 100) + 50;
      
      // If it's a space or punctuation, it often takes slightly longer
      if (char === ' ' || char === '.' || char === ',') {
        delay += Math.random() * 100;
      }
      
      // 3. Simulated Typo (1% chance per character)
      if (Math.random() < 0.01 && i > 0 && i < text.length - 1) {
        // Type a wrong character (we just pick an adjacent key or random letter)
        const wrongChar = String.fromCharCode(char.charCodeAt(0) + 1);
        await page.keyboard.type(wrongChar, { delay: Math.random() * 50 + 50 });
        
        // Pause to "realize" mistake
        await new Promise(r => setTimeout(r, Math.random() * 300 + 200));
        
        // Press Backspace
        await page.keyboard.press('Backspace', { delay: Math.random() * 50 + 50 });
        
        // Brief pause before correcting
        await new Promise(r => setTimeout(r, Math.random() * 100 + 50));
      }
      
      // Type the actual character
      await page.keyboard.type(char, { delay });
    }
    return newPos;
  }
}
