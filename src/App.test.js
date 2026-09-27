import { render, screen, fireEvent } from '@testing-library/react';
import App from './App';

test('landing is the default page', () => {
  render(<App />);
  // Hero CTA present on the landing page
  expect(
    screen.getAllByRole('button', { name: /browse opportunities made for you/i }).length
  ).toBeGreaterThan(0);
  expect(screen.getByRole('heading', { name: /stop guessing/i })).toBeInTheDocument();
});

test('landing funnels into the opportunity catalogue', () => {
  render(<App />);
  const cta = screen.getAllByRole('button', { name: /browse opportunities made for you/i })[0];
  fireEvent.click(cta);
  // Catalogue search input appears once we navigate to home
  expect(
    screen.getByLabelText(/search inclusive jobs/i)
  ).toBeInTheDocument();
  // Floating return to landing is available
  expect(
    screen.getByRole('button', { name: /back to accessable home/i })
  ).toBeInTheDocument();
});
