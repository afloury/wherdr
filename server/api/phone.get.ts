import { phoneStatus } from '../utils/phone'

// Settings › Phone: state of the phone address (server/utils/phone.ts). Open
// to every session the guard lets in (network, then the passkey lock if set).
export default defineApi(async () => phoneStatus())
