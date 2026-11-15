// src/lib/services/geoService.ts

/**
 * Represents the geographic information derived from an IP address.
 */
export interface GeoLocation {
  countryCode: string | null;
  countryName: string | null;
  stateCode: string | null;
  stateName: string | null;
  city: string | null;
}

/**
 * A representative, embedded GeoIP database. In a production environment at scale,
 * this would be replaced by a service like MaxMind, which uses a frequently updated
 * external database file. This implementation provides a "real" lookup mechanism
 * against a self-contained dataset.
 */
export const MOCK_GEO_DB: { [range: string]: GeoLocation } = {
  // Brazilian IPs
  "177.43.0.0/16": { countryCode: 'BR', countryName: 'Brazil', stateCode: 'SP', stateName: 'São Paulo', city: 'São Paulo' },
  "187.19.0.0/16": { countryCode: 'BR', countryName: 'Brazil', stateCode: 'RJ', stateName: 'Rio de Janeiro', city: 'Rio de Janeiro' },
  "189.1.0.0/16": { countryCode: 'BR', countryName: 'Brazil', stateCode: 'BA', stateName: 'Bahia', city: 'Salvador' },
  "200.150.0.0/16": { countryCode: 'BR', countryName: 'Brazil', stateCode: 'CE', stateName: 'Ceará', city: 'Fortaleza' },
  "201.10.0.0/16": { countryCode: 'BR', countryName: 'Brazil', stateCode: 'RS', stateName: 'Rio Grande do Sul', city: 'Porto Alegre' },
  "177.8.0.0/16": { countryCode: 'BR', countryName: 'Brazil', stateCode: 'MG', stateName: 'Minas Gerais', city: 'Belo Horizonte' },

  // US IPs
  "8.8.8.0/24": { countryCode: 'US', countryName: 'United States', stateCode: 'CA', stateName: 'California', city: 'Mountain View' },
  "1.1.1.0/24": { countryCode: 'US', countryName: 'United States', stateCode: 'CA', stateName: 'California', city: 'Los Angeles' },
  "207.97.227.239/32": { countryCode: 'US', countryName: 'United States', stateCode: 'NY', stateName: 'New York', city: 'New York' },

  // European IPs
  "85.214.0.0/16": { countryCode: 'DE', countryName: 'Germany', stateCode: 'BE', stateName: 'Berlin', city: 'Berlin' },
  "89.155.0.0/16": { countryCode: 'PT', countryName: 'Portugal', stateCode: '11', stateName: 'Lisbon', city: 'Lisbon' },
};


/**
 * Converts an IPv4 string to its 32-bit integer representation.
 * @param ip The IPv4 address string.
 * @returns The numeric representation of the IP.
 */
const ipToLong = (ip: string): number => {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + parseInt(octet, 10), 0) >>> 0;
};

/**
 * Checks if an IP address is within a private range.
 * @param ip The IP address to check.
 * @returns True if the IP is private, false otherwise.
 */
const isPrivateIp = (ip: string): boolean => {
  if (!ip) return false;
  const parts = ip.split('.').map(Number);
  if (parts.length !== 4) return false; // Not a valid IPv4
  if (parts.some(isNaN)) return false; // Check for invalid numbers
  // 10.0.0.0/8
  if (parts[0] === 10) return true;
  // 172.16.0.0/12
  if (parts[0] === 172 && (parts[1] >= 16 && parts[1] <= 31)) return true;
  // 192.168.0.0/16
  if (parts[0] === 192 && parts[1] === 168) return true;
  // 127.0.0.0/8 (localhost)
  if (parts[0] === 127) return true;
  return false;
};

/**
 * Resolves an IP address to a geographic location using the mock database.
 * This function simulates a real GeoIP lookup by checking against CIDR ranges.
 * @param ip The IPv4 address to resolve.
 * @returns A GeoLocation object or null if not found.
 */
export const resolveIp = (ip: string): GeoLocation | null => {
  if (isPrivateIp(ip)) {
    return { countryCode: 'PVT', countryName: 'Private Network', stateCode: null, stateName: null, city: null };
  }

  const numericIp = ipToLong(ip);
  if (isNaN(numericIp)) {
      return { countryCode: 'XX', countryName: 'Unknown', stateCode: null, stateName: null, city: null };
  }
  
  // This loop simulates a lookup in a GeoIP database.
  for (const range in MOCK_GEO_DB) {
    const [rangeIp, cidrStr] = range.split('/');
    const cidr = parseInt(cidrStr, 10);
    
    // Create bitmask for comparison
    const mask = ((-1) << (32 - cidr)) >>> 0;
    const numericRangeIp = ipToLong(rangeIp);

    if ((numericIp & mask) === (numericRangeIp & mask)) {
      return MOCK_GEO_DB[range];
    }
  }

  // If no range matches, return Unknown.
  return { countryCode: 'XX', countryName: 'Unknown', stateCode: null, stateName: null, city: null };
};

      