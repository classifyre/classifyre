import { nameQuery } from './governance-meaning.service';

describe('nameQuery (GOV meaning suggestions)', () => {
  it('turns table and column names into words to look up', () => {
    expect(nameQuery('crm.customer_orders')).toBe('customer orders');
    expect(nameQuery('lake/tables/delta_orders.parquet')).toBe('delta orders');
    expect(nameQuery('email')).toBe('email');
    expect(nameQuery('customerName')).toBe('customer Name');
  });

  it('skips names too short or numeric to mean anything', () => {
    expect(nameQuery('id')).toBeNull();
    expect(nameQuery('2024_01')).toBeNull();
  });
});
