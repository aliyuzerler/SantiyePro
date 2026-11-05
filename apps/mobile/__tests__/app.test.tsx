import { render } from '@testing-library/react-native';
import { describe, expect, it } from '@jest/globals';
import App from '../App';

describe('App (Faz 00 boot iskeleti)', () => {
  it('çökmeden render ediliyor', async () => {
    const screen = await render(<App />);
    expect(screen.getByText('ŞantiyePro')).toBeTruthy();
    expect(screen.getByText('PROJECT CONTROL')).toBeTruthy();
  });
});
