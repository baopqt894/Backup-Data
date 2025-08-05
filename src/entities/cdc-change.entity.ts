import { Entity, Column, PrimaryGeneratedColumn, CreateDateColumn } from 'typeorm';

@Entity('cdc_changes')
export class CdcChange {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  table_name: string;

  @Column()
  operation: string; // INSERT, UPDATE, DELETE

  @Column('jsonb')
  old_data: any;

  @Column('jsonb')
  new_data: any;

  @CreateDateColumn()
  timestamp: Date;

  @Column({ nullable: true })
  lsn: string; // Log Sequence Number
}
