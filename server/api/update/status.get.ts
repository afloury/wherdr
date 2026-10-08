import pkg from '../../../package.json'
import { readJob, wherdrDir } from '../../utils/selfupdate'

// Progress of a one-tap update, polled by the app while wherdr restarts.
export default defineApi(() => ({ version: pkg.version, job: readJob(wherdrDir()) }))
