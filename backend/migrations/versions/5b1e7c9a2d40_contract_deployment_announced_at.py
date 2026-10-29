"""contract deployment announced_at

Revision ID: 5b1e7c9a2d40
Revises: 737ef529e077
Create Date: 2026-10-29 17:30:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = '5b1e7c9a2d40'
down_revision = '737ef529e077'
branch_labels = None
depends_on = None


def upgrade():
    with op.batch_alter_table('contract_deployments', schema=None) as batch_op:
        batch_op.add_column(sa.Column('announced_at', sa.DateTime(timezone=True), nullable=True))
    # Launches from before the launch channel count as posted, so turning it
    # on doesn't post the whole history.
    op.execute("UPDATE contract_deployments SET announced_at = created_at")


def downgrade():
    with op.batch_alter_table('contract_deployments', schema=None) as batch_op:
        batch_op.drop_column('announced_at')
