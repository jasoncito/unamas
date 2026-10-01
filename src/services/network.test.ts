import NetInfo from '@react-native-community/netinfo';
import { AppState } from 'react-native';

import { onReconnectOrForeground } from './network';

jest.mock('@react-native-community/netinfo', () => ({ addEventListener: jest.fn() }));

describe('onReconnectOrForeground', () => {
  let net: (s: { isConnected: boolean | null }) => void;
  let app: (s: string) => void;
  const unsubscribeNet = jest.fn();
  const removeApp = jest.fn();

  beforeEach(() => {
    jest.mocked(NetInfo.addEventListener).mockImplementation((cb) => {
      net = cb as unknown as typeof net;
      return unsubscribeNet;
    });
    jest.spyOn(AppState, 'addEventListener').mockImplementation((_, cb) => {
      app = cb as typeof app;
      return { remove: removeApp } as unknown as ReturnType<typeof AppState.addEventListener>;
    });
  });

  it('back to the foreground, or the signal back after losing it; not the first report, not staying online', () => {
    const chance = jest.fn();
    const stop = onReconnectOrForeground(chance);

    net({ isConnected: true }); // first report: nothing new
    net({ isConnected: true });
    expect(chance).not.toHaveBeenCalled();

    net({ isConnected: false });
    net({ isConnected: true }); // back
    expect(chance).toHaveBeenCalledTimes(1);

    app('background');
    app('active');
    expect(chance).toHaveBeenCalledTimes(2);

    stop();
    expect(unsubscribeNet).toHaveBeenCalled();
    expect(removeApp).toHaveBeenCalled();
  });
});
