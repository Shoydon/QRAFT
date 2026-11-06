import { redirect } from 'next/navigation';

/**
 * The wallet moved to the root. This route stays because /app is the address
 * in the README, the local run instructions and anything already shared, and
 * those should land on the wallet rather than a 404.
 *
 * Temporary rather than permanent: a permanent redirect is cached by the
 * browser and would be awkward to undo if the routes move again.
 */
export default function Page() {
  redirect('/');
}
