import { createClient } from '@supabase/supabase-js';
import { Mp3Encoder } from '@breezystack/lamejs';

window.BedtimeVendor = Object.freeze({ createClient, Mp3Encoder });
window.Mp3Encoder = Mp3Encoder;
