/* إعدادات تطبيق الويب في Firebase (Project settings ← Your apps). دي معرّفات عامة مش أسرار؛
   الحماية الحقيقية من قواعد Firestore (firestore.rules) وتسجيل الدخول. */
export const firebaseConfig = {
  apiKey: 'AIzaSyAwQTx-Lr2ipeyTp6D6mX91AYtUqHlmvCI',
  authDomain: 'dr-sana-d2a19.firebaseapp.com',
  projectId: 'dr-sana-d2a19',
  storageBucket: 'dr-sana-d2a19.firebasestorage.app',
  messagingSenderId: '246362407095',
  appId: '1:246362407095:web:07ffa6f142fdf00826cd32',
};

/* UID حساب المالك: محتوى المالك (الدروس والامتحانات) بيظهر لكل المستخدمين. لازم يكون نفسه في firestore.rules */
export const OWNER_UID = '6hlOBP4pJCckI2rWDDY3fYHQXpr1';
