"""contract deployment x_announced_at

Revision ID: a3d8e6f1c254
Revises: 9c4f2e81b7a3
Create Date: 2026-11-01 12:00:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a3d8e6f1c254'
down_revision = '9c4f2e81b7a3'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('contract_deployments', schema=None) as batch_op:
        batch_op.add_column(sa.Column('x_announced_at', sa.DateTime(timezone=True), nullable=True))
    # Launches from before the X account count as posted, so turning it on
    # doesn't post the whole history.
    op.execute("UPDATE contract_deployments SET x_announced_at = created_at")


def downgrade():
    with op.batch_alter_table('contract_deployments', schema=None) as batch_op:
        batch_op.drop_column('x_announced_at')
