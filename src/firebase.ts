import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore, doc, getDocFromServer, runTransaction, Timestamp } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth();

/**
 * Global tracking for app statistics
 */
export const trackEvent = async (event: 'export' | 'request_click') => {
  try {
    const statsRef = doc(db, 'system', 'stats');
    await runTransaction(db, async (transaction) => {
      const statsDoc = await transaction.get(statsRef);
      if (!statsDoc.exists()) {
        transaction.set(statsRef, {
          total_exports: event === 'export' ? 1 : 0,
          total_request_clicks: event === 'request_click' ? 1 : 0,
          last_updated: Timestamp.now()
        });
      } else {
        const data = statsDoc.data();
        transaction.update(statsRef, {
          [event === 'export' ? 'total_exports' : 'total_request_clicks']: (data[event === 'export' ? 'total_exports' : 'total_request_clicks'] || 0) + 1,
          last_updated: Timestamp.now()
        });
      }
    });
  } catch (error) {
    console.error('Failed to track event:', error);
  }
};

// Connection test
async function testConnection() {
  try {
    await getDocFromServer(doc(db, 'system', 'connection_test'));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error("Please check your Firebase configuration. The client is offline.");
    }
  }
}
testConnection();
